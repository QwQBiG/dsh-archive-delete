import { createHash, randomUUID } from 'node:crypto';
import {
  ArchiveError, type Action, type ArchiveApi, type BatchResult, type DshAdapter,
  type ItemResult, type Overview, type Preview, type PreviewItem, type SessionGroup,
} from './contracts.js';
import { TrashStore, groupFingerprint, type Operation, type OperationContext } from './storage.js';
import { RequestJournal } from './request-journal.js';

interface Prepared { preview: Preview; groups: Map<string, SessionGroup>; fingerprints: Map<string, string> }
const REQUEST_ID = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const MESSAGE: Record<string, string> = {
  active: 'The session or a related task is still in use.',
  'not-archived': 'Only archived sessions can be moved to trash.',
  busy: 'Another process holds this session. Nothing was moved.',
  'source-changed': 'Session data changed. Review a new preview before continuing.',
  'recovery-required': 'An interrupted operation needs recovery before this session can be changed.',
};
export function safeError(error: unknown): { code: string; message: string } {
  if (error instanceof ArchiveError) return { code: error.code, message: error.message };
  return { code: 'operation-failed', message: 'The operation could not complete. Its recorded state is available for recovery.' };
}
function failure(id: string, title: string, error: unknown): ItemResult {
  const detail = safeError(error); return { id, title, status: 'failed', ...detail };
}
function result(requestId: string, action: Action | 'cancel', items: ItemResult[]): BatchResult {
  return { operationId: requestId, action, items, counts: {
    succeeded: items.filter(i => ['moved', 'restored', 'purged', 'cancelled'].includes(i.status)).length,
    pending: items.filter(i => i.status === 'pending').length,
    skipped: items.filter(i => i.status === 'skipped').length,
    failed: items.filter(i => i.status === 'failed').length,
  } };
}
function validateIds(ids: unknown): asserts ids is string[] {
  if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(v => typeof v !== 'string' || !v || v.length > 512))
    throw new ArchiveError('invalid-request', 'Select between 1 and 100 valid targets.');
  if (new Set(ids).size !== ids.length) throw new ArchiveError('invalid-request', 'Duplicate targets are not allowed.');
}
function checkRequestId(value: string): void {
  if (!REQUEST_ID.test(value)) throw new ArchiveError('invalid-request', 'A valid request identifier is required.');
}
function groupReady(group: SessionGroup): void {
  const root = group.members.find(m => m.id === group.sessionId);
  if (!root?.archived) throw new ArchiveError('not-archived', MESSAGE['not-archived']!);
  if (group.members.some(m => m.activity.length)) throw new ArchiveError('active', MESSAGE.active!);
}

/** Serializes user operations; the adapter is the only dependency that knows DSH internals. */
export class ArchiveService implements ArchiveApi {
  private tail: Promise<unknown> = Promise.resolve();
  private previews = new Map<string, Prepared>();
  private startupFailures: ItemResult[] = [];
  private initialized = false;
  private closing = false;
  private maintenance: 'update-in-progress' | 'update-restart-required' | undefined;
  private listing: Promise<Overview> | undefined;
  private readonly requests: RequestJournal;
  constructor(readonly adapter: DshAdapter, readonly store: TrashStore) { this.requests = new RequestJournal(store.root); }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new ArchiveError('plugin-stopping', 'The plugin is stopping. Refresh after it reloads.'));
    const guarded = () => {
      if (this.maintenance) throw new ArchiveError(this.maintenance, 'A plugin update is in progress or waiting for a restart.');
      return work();
    };
    const task = this.tail.then(guarded, guarded); this.tail = task.catch(() => {}); return task;
  }
  /** Drain archive work before package replacement, without putting installation
   * inside the tail: HMR may await close() while the native manager still runs. */
  async beginUpdate(): Promise<(restartRequired?: boolean) => void> {
    return this.serialize(async () => {
      this.maintenance = 'update-in-progress';
      return restartRequired => { this.maintenance = restartRequired ? 'update-restart-required' : undefined; };
    });
  }
  async close(): Promise<void> { this.closing = true; this.previews.clear(); await this.tail; this.previews.clear(); }
  private async supported(): Promise<void> {
    const support = await this.adapter.capabilities();
    if (!support.supported) throw new ArchiveError('unsupported-host', support.reason ?? 'This DSH host is not supported.');
  }
  async initialize(): Promise<void> {
    return this.serialize(async () => {
      if (this.initialized) return;
      if (!(await this.adapter.capabilities()).supported) { this.initialized = true; return; }
      await this.store.initialize();
      await this.store.cleanTemporaryFiles();
      await this.requests.cleanTemporaryFiles();
      // Repair first, then make exactly one pass over requests explicitly queued by the user.
      const operations = await this.store.operations();
      for (const op of operations.filter(o => o.phase !== 'pending')) {
        try { await this.recover(op); }
        catch (e) { this.startupFailures.push(failure(op.group.sessionId, op.group.title, e)); }
      }
      for (const op of operations.filter(o => o.phase === 'pending')) {
        try {
          if ((await this.store.operations()).some(o => o.phase !== 'pending' && o.group.sessionId === op.group.sessionId))
            throw new ArchiveError('recovery-required', MESSAGE['recovery-required']!);
          const fresh = await this.adapter.inspect(op.group.sessionId);
          groupReady(fresh);
          if (groupFingerprint(fresh) !== groupFingerprint(op.group)) {
            const changed = failure(op.targetId ?? op.group.sessionId, op.group.title, new ArchiveError('source-changed', MESSAGE['source-changed']!));
            if (op.requestId) await this.requests.record(op.requestId, changed);
            await this.store.finish(op);
            this.startupFailures.push(changed);
            continue;
          }
          const moved = await this.trashGroup(fresh, op, op.requestId ? { requestId: op.requestId, targetId: op.targetId! } : undefined);
          if (op.requestId) await this.requests.record(op.requestId, { ...moved, id: op.targetId! });
          if (moved.status === 'moved') await this.finishTerminals(op.requestId, op.targetId, op.entryId);
          if (moved.status === 'failed') this.startupFailures.push(moved);
        } catch (e) {
          const code = safeError(e).code;
          // Changed or no-longer-archived data needs fresh consent, never an old queued request.
          if (['not-archived', 'source-changed', 'missing-session', 'session-missing', 'session-not-found'].includes(code)) {
            if (op.requestId) await this.requests.record(op.requestId, failure(op.targetId!, op.group.title, e));
            await this.store.finish(op);
          }
          this.startupFailures.push(failure(op.group.sessionId, op.group.title, e));
        }
      }
      for (const request of await this.requests.incomplete()) await this.requests.complete(request.requestId, true);
      this.initialized = true;
    });
  }
  private async recover(op: Operation): Promise<void> {
    const directories = await this.store.locations(op);
    const held = await this.adapter.acquireLocated(op.group, directories);
    if (held && held.kind !== 'acquired') throw new ArchiveError('busy', 'Recovery is waiting for the session write lock.');
    let outcome: ItemResult | undefined;
    let retain = false;
    try {
      if (op.phase === 'moving' || op.phase === 'detached' || op.phase === 'trashed') {
        if (await this.store.hasEntry(op.entryId)) {
          await this.store.assertCommittedTrash(op);
          await this.adapter.removeRegistry(op.group);
          outcome = { id: op.targetId ?? op.group.sessionId, title: op.group.title, status: 'moved' };
        } else {
          await this.store.rollbackTrash(op); await this.adapter.restoreRegistry(op.group);
          outcome = failure(op.targetId ?? op.group.sessionId, op.group.title, new ArchiveError('operation-interrupted', 'The interrupted move was rolled back. Review before retrying.'));
        }
      } else if (op.phase === 'restoring' || op.phase === 'restored-metadata' || op.phase === 'restored') {
        if (op.phase !== 'restoring') {
          await this.adapter.restoreRegistry(op.group); await this.store.commitRestore(op);
          outcome = { id: op.targetId ?? op.entryId, title: op.group.title, status: 'restored' };
        } else {
          await this.store.rollbackRestore(op); await this.adapter.removeRegistry(op.group);
          outcome = failure(op.targetId ?? op.entryId, op.group.title, new ArchiveError('operation-interrupted', 'The interrupted restore was rolled back. Review before retrying.'));
        }
      } else if (op.phase === 'purging' || op.phase === 'purged') {
        if (await this.store.completeEmptyPurge(op)) outcome = { id: op.targetId ?? op.entryId, title: op.group.title, status: 'purged' };
        else {
          outcome = failure(op.targetId ?? op.entryId, op.group.title,
            new ArchiveError('purge-interrupted', 'A permanent deletion was interrupted. Review the entry and retry explicitly.'));
          this.startupFailures.push(outcome); retain = true;
        }
      }
      if (outcome && op.requestId) await this.requests.record(op.requestId, outcome);
      if (!retain) await this.store.finish(op);
    } finally { if (held?.kind === 'acquired') await held.lease.release(); }
  }
  private async finishTerminals(requestId?: string, targetId?: string, purgedEntryId?: string): Promise<void> {
    for (const op of await this.store.operations()) {
      if (purgedEntryId && op.entryId === purgedEntryId && ['purging', 'purged'].includes(op.phase)) {
        if (op.requestId) await this.requests.record(op.requestId, { id: op.targetId!, title: '', status: 'purged' });
        await this.store.finish(op);
      } else if (requestId && op.requestId === requestId && op.targetId === targetId && ['trashed', 'restored', 'purged'].includes(op.phase)) await this.store.finish(op);
    }
  }
  async list(): Promise<Overview> {
    // Coalesce overlapping refreshes without reading halfway through a file transition.
    if (this.listing) return this.listing;
    const listing = this.serialize(async () => {
      const support = await this.adapter.capabilities();
      if (!support.supported) return { support, archived: [], trash: [], recentResults: [] };
      const pending = new Map((await this.store.operations()).filter(o => o.phase === 'pending').map(o => [o.group.sessionId, o]));
      const archived = (await this.adapter.listArchived()).map(s => {
        const p = pending.get(s.id); return p ? { ...s, pending: true, pendingReason: p.reason ?? 'Waiting for the next DSH start.' } : s;
      });
      const recent = await this.requests.recent();
      if (this.startupFailures.length) recent.unshift(result('startup-recovery', 'trash', this.startupFailures));
      const trash = await this.store.list();
      const issues = [...this.adapter.listIssues?.() ?? [], ...this.store.listIssues()];
      return { support, archived, trash, recentResults: recent, ...(issues.length ? { issues } : {}) };
    });
    this.listing = listing;
    try { return await listing; }
    finally { if (this.listing === listing) this.listing = undefined; }
  }
  async preview(action: Action, ids: string[]): Promise<Preview> {
    return this.serialize(async () => {
      await this.supported(); validateIds(ids);
      if (!['trash', 'restore', 'purge'].includes(action)) throw new ArchiveError('invalid-request', 'Unknown operation.');
      const items: PreviewItem[] = []; const groups = new Map<string, SessionGroup>(); const fingerprints = new Map<string, string>();
      const occupied = new Set<string>();
      const operations = await this.store.operations();
      for (const key of ids) {
        let title = key;
        try {
          if (action === 'trash') {
            if (operations.some(o => o.group.sessionId === key && o.phase !== 'pending')) throw new ArchiveError('recovery-required', MESSAGE['recovery-required']!);
            if (operations.some(o => o.group.sessionId === key && o.phase === 'pending')) throw new ArchiveError('already-pending', 'This session is already waiting for a restart.');
            const group = await this.adapter.inspect(key); title = group.title; groupReady(group);
            if (group.members.some(m => occupied.has(m.id))) throw new ArchiveError('overlapping-targets', 'These selections share a related session.');
            group.members.forEach(m => occupied.add(m.id)); groups.set(key, group); fingerprints.set(key, groupFingerprint(group));
            items.push({ id: key, sessionId: group.sessionId, title, memberIds: group.members.map(m => m.id),
              sizeBytes: group.members.reduce((n, m) => n + m.sizeBytes, 0), disposition: group.members.some(m => m.loaded) ? 'pending' : 'ready' });
          } else {
            const snapshot = await this.store.entrySnapshot(key);
            const manifest = snapshot.manifest; title = manifest.group.title;
            if (action === 'restore') await this.store.checkRestore(key);
            groups.set(key, manifest.group); fingerprints.set(key, snapshot.fingerprint);
            items.push({ id: key, sessionId: manifest.group.sessionId, title, memberIds: manifest.group.members.map(m => m.id),
              sizeBytes: snapshot.sizeBytes, disposition: 'ready' });
          }
        } catch (e) { items.push({ id: key, title, sessionId: key, memberIds: [], sizeBytes: 0, disposition: 'blocked', ...safeError(e) }); }
      }
      for (const [key, p] of this.previews) if (p.preview.expiresAt < Date.now()) this.previews.delete(key);
      if (this.previews.size >= 20) this.previews.delete(this.previews.keys().next().value!);
      const preview: Preview = { id: randomUUID(), action, items, expiresAt: Date.now() + 5 * 60_000 };
      this.previews.set(preview.id, { preview, groups, fingerprints }); return preview;
    });
  }
  async execute(previewId: string, requestId: string): Promise<BatchResult> {
    return this.serialize(async () => {
      await this.supported(); checkRequestId(requestId);
      const fingerprint = createHash('sha256').update(`execute:${previewId}`).digest('hex');
      let saved = await this.requests.load(requestId, fingerprint);
      if (saved?.complete) return saved.result;
      if (saved) {
        for (const op of await this.store.operations()) if (op.requestId === requestId && op.phase !== 'pending') await this.recover(op);
        saved = (await this.requests.load(requestId, fingerprint))!;
      }
      let prepared: Prepared;
      if (saved) prepared = { preview: saved.preview!, groups: new Map(Object.entries(saved.groups!)), fingerprints: new Map(Object.entries(saved.fingerprints!)) };
      else {
        const candidate = this.previews.get(previewId);
        if (!candidate || candidate.preview.expiresAt < Date.now()) throw new ArchiveError('preview-expired', 'The preview expired. Refresh and review the targets again.');
        prepared = candidate;
        // Consume before publication: even a write that publishes then reports
        // an fsync error cannot leave this confirmation usable under a second ID.
        this.previews.delete(previewId);
        saved = await this.requests.begin(requestId, fingerprint, { preview: prepared.preview,
          groups: Object.fromEntries(prepared.groups), fingerprints: Object.fromEntries(prepared.fingerprints) });
      }
      for (const item of prepared.preview.items) {
        if (saved.result.items.some(previous => previous.id === item.id)) continue;
        let outcome: ItemResult;
        if (item.disposition === 'blocked') {
          outcome = { id: item.id, title: item.title, status: 'skipped', ...(item.code ? { code: item.code } : {}), ...(item.message ? { message: item.message } : {}) };
        } else try {
          const expected = prepared.groups.get(item.id)!;
          if (prepared.preview.action === 'trash') {
            const fresh = await this.adapter.inspect(item.id); groupReady(fresh);
            if (groupFingerprint(fresh) !== prepared.fingerprints.get(item.id)) throw new ArchiveError('source-changed', MESSAGE['source-changed']!);
            outcome = await this.trashGroup(fresh, undefined, { requestId, targetId: item.id }, true);
          } else {
            const current = await this.store.manifest(item.id);
            if (groupFingerprint(current.group) !== groupFingerprint(expected)
              || await this.store.entryFingerprint(item.id) !== prepared.fingerprints.get(item.id))
              throw new ArchiveError('source-changed', MESSAGE['source-changed']!);
            if (prepared.preview.action === 'restore') {
              await this.restoreEntry(item.id, { requestId, targetId: item.id }, prepared.fingerprints.get(item.id)!); outcome = { id: item.id, title: item.title, status: 'restored' };
            } else { await this.purgeEntry(item.id, { requestId, targetId: item.id }, prepared.fingerprints.get(item.id)!); outcome = { id: item.id, title: item.title, status: 'purged' }; }
          }
        } catch (e) {
          // A rename can commit before its next journal write. Resolve that durable
          // operation before reporting its outcome or allowing a retry.
          const interrupted = (await this.store.operations()).filter(op => op.requestId === requestId && op.targetId === item.id && op.phase !== 'pending');
          for (const op of interrupted) await this.recover(op);
          const recovered = (await this.requests.load(requestId, fingerprint))?.result.items.find(previous => previous.id === item.id);
          outcome = recovered ?? failure(item.id, item.title, e);
        }
        saved = await this.requests.record(requestId, outcome);
        await this.finishTerminals(requestId, item.id, outcome.status === 'purged' ? item.id : undefined);
      }
      return this.requests.complete(requestId);
    });
  }
  private async trashGroup(group: SessionGroup, pending?: Operation, context?: OperationContext, releaseIdle = false): Promise<ItemResult> {
    let lease = await this.adapter.acquire(group);
    // Only a fresh user confirmation can release an idle native lifecycle.
    // Startup replay retains its original one-pass, non-interrupting behavior.
    if (lease.kind === 'loaded' && releaseIdle && this.adapter.releaseIdle && await this.adapter.releaseIdle(group)) {
      const cold = await this.adapter.inspect(group.sessionId); groupReady(cold);
      if (groupFingerprint(cold) !== groupFingerprint(group)) throw new ArchiveError('source-changed', MESSAGE['source-changed']!);
      lease = await this.adapter.acquire(cold);
    }
    if (lease.kind === 'busy') throw new ArchiveError('busy', MESSAGE.busy!);
    if (lease.kind === 'loaded') {
      if (!pending) await this.store.queue(group, 'Waiting for DSH to release this idle session at the next start.', context);
      return { id: group.sessionId, title: group.title, status: 'pending', code: 'host-loaded', message: 'Waiting for the next DSH start.' };
    }
    let op: Operation | undefined;
    try {
      const fresh = await this.adapter.inspect(group.sessionId); groupReady(fresh);
      if (groupFingerprint(fresh) !== groupFingerprint(group)) throw new ArchiveError('source-changed', MESSAGE['source-changed']!);
      op = await this.store.prepareTrash(fresh, pending, context);
      await this.adapter.removeRegistry(fresh); await this.store.markDetached(op); await this.store.commitTrash(op);
      return { id: group.sessionId, title: group.title, status: 'moved' };
    } catch (e) {
      op ??= (await this.store.operations()).find(o => ['moving', 'detached'].includes(o.phase) && o.group.sessionId === group.sessionId);
      if (op && !await this.store.hasEntry(op.entryId)) {
        try { await this.store.rollbackTrash(op); await this.adapter.restoreRegistry(op.group); await this.store.finish(op); }
        catch { throw new ArchiveError('recovery-required', MESSAGE['recovery-required']!); }
      }
      throw e;
    } finally { await lease.lease.release(); }
  }
  private async restoreEntry(entryId: string, context: OperationContext, expectedFingerprint: string): Promise<void> {
    let op: Operation | undefined;
    const manifest = await this.store.manifest(entryId);
    const held = await this.adapter.acquireLocated(manifest.group, await this.store.entryLocations(entryId));
    if (held.kind !== 'acquired') throw new ArchiveError('busy', 'Restore is waiting for the session write lock.');
    try {
      if (await this.store.entryFingerprint(entryId) !== expectedFingerprint) throw new ArchiveError('source-changed', MESSAGE['source-changed']!);
      op = await this.store.prepareRestore(entryId, context); await this.adapter.restoreRegistry(op.group);
      await this.store.markRestored(op); await this.store.commitRestore(op);
    } catch (e) {
      op ??= (await this.store.operations()).find(o => ['restoring', 'restored-metadata'].includes(o.phase) && o.entryId === entryId);
      if (op && op.phase === 'restoring') {
        try { await this.store.rollbackRestore(op); await this.adapter.removeRegistry(op.group); await this.store.finish(op); }
        catch { throw new ArchiveError('recovery-required', MESSAGE['recovery-required']!); }
      }
      throw e;
    } finally { await held.lease.release(); }
  }
  private async purgeEntry(entryId: string, context: OperationContext, expectedFingerprint: string): Promise<void> {
    const manifest = await this.store.manifest(entryId);
    const held = await this.adapter.acquireLocated(manifest.group, await this.store.entryLocations(entryId));
    if (held.kind !== 'acquired') throw new ArchiveError('busy', 'Permanent deletion is waiting for the session write lock.');
    try {
      if (await this.store.entryFingerprint(entryId) !== expectedFingerprint) throw new ArchiveError('source-changed', MESSAGE['source-changed']!);
      await this.store.purge(entryId, context);
    } finally { await held.lease.release(); }
  }
  async cancelPending(ids: string[], requestId: string): Promise<BatchResult> {
    return this.serialize(async () => {
      await this.supported(); checkRequestId(requestId); validateIds(ids);
      const fingerprint = createHash('sha256').update(`cancel:${JSON.stringify(ids)}`).digest('hex');
      let saved = await this.requests.load(requestId, fingerprint); if (saved?.complete) return saved.result;
      saved ??= await this.requests.begin(requestId, fingerprint, {
        preview: { id: requestId, action: 'trash', expiresAt: Date.now(), items: ids.map(key => ({ id: key, title: '', sessionId: key, memberIds: [], sizeBytes: 0, disposition: 'ready' })) },
        groups: {}, fingerprints: {},
      }, 'cancel');
      for (const key of ids) {
        if (saved.result.items.some(item => item.id === key)) continue;
        const pending = (await this.store.operations()).filter(op => op.phase === 'pending' && op.group.sessionId === key);
        for (const op of pending) {
          if (op.requestId) await this.requests.record(op.requestId, { id: op.targetId!, title: '', status: 'cancelled' });
          await this.store.finish(op);
        }
        saved = await this.requests.record(requestId, { id: key, title: '', status: pending.length ? 'cancelled' : 'skipped' });
      }
      return this.requests.complete(requestId);
    });
  }
}
