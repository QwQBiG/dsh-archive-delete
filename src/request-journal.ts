import { randomUUID } from 'node:crypto';
import { lstat, open, readdir, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ArchiveError, type BatchResult, type ItemResult, type Preview, type SessionGroup } from './contracts.js';
import { assertPrivateDirectory, readBoundedJson, syncDirectory } from './filesystem.js';

const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const STATUSES = new Set(['moved', 'pending', 'restored', 'purged', 'cancelled', 'skipped', 'failed']);
export interface RequestContext {
  preview: Preview;
  groups: Record<string, SessionGroup>;
  fingerprints: Record<string, string>;
}
export interface RequestRecord {
  schema: 1;
  requestId: string;
  fingerprint: string;
  complete: boolean;
  preview?: Preview;
  groups?: Record<string, SessionGroup>;
  fingerprints?: Record<string, string>;
  result: BatchResult;
}
function missing(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}
function requestId(value: string): string {
  if (!UUID.test(value)) throw new ArchiveError('invalid-request', 'A valid request identifier is required.');
  return value;
}
function counts(items: ItemResult[]): BatchResult['counts'] {
  return {
    succeeded: items.filter(item => ['moved', 'restored', 'purged', 'cancelled'].includes(item.status)).length,
    pending: items.filter(item => item.status === 'pending').length,
    skipped: items.filter(item => item.status === 'skipped').length,
    failed: items.filter(item => item.status === 'failed').length,
  };
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function validItem(value: unknown): value is ItemResult {
  return object(value) && typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 512 && typeof value.title === 'string'
    && typeof value.status === 'string' && STATUSES.has(value.status)
    && (value.code === undefined || typeof value.code === 'string')
    && (value.message === undefined || typeof value.message === 'string');
}
function validate(value: unknown, id: string): asserts value is RequestRecord {
  if (!object(value) || value.schema !== 1 || value.requestId !== id || typeof value.fingerprint !== 'string'
    || typeof value.complete !== 'boolean' || !object(value.result) || value.result.operationId !== id
    || !['trash', 'restore', 'purge', 'cancel'].includes(String(value.result.action))
    || !Array.isArray(value.result.items) || value.result.items.length > 100 || !value.result.items.every(validItem)
    || new Set(value.result.items.map(item => item.id)).size !== value.result.items.length)
    throw new ArchiveError('corrupt-state', 'A request receipt is invalid.');
  if (value.complete) {
    if (value.preview !== undefined || value.groups !== undefined || value.fingerprints !== undefined
      || value.result.items.some(item => item.title !== ''))
      throw new ArchiveError('corrupt-state', 'A completed request receipt retains recovery content.');
  } else if (!object(value.preview) || typeof value.preview.id !== 'string'
    || !['trash', 'restore', 'purge'].includes(String(value.preview.action))
    || (value.preview.action !== value.result.action && !(value.result.action === 'cancel' && value.preview.action === 'trash'))
    || !Array.isArray(value.preview.items) || !value.preview.items.length || value.preview.items.length > 100
    || !value.preview.items.every(item => object(item) && typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 512 && typeof item.title === 'string')
    || new Set(value.preview.items.map(item => item.id)).size !== value.preview.items.length
    || !object(value.groups) || !object(value.fingerprints)) {
    throw new ArchiveError('corrupt-state', 'An incomplete request receipt is invalid.');
  }
}

/** Durable request progress. The host holds the plugin-store lease around its lifetime. */
export class RequestJournal {
  private readonly directory: string;
  private tail: Promise<unknown> = Promise.resolve();
  private recentIndex: { id: string; mtime: number }[] | undefined;
  private indexedDirectory: string | undefined;
  constructor(root: string) { this.directory = join(resolve(root), 'receipts'); }
  private path(id: string): string { return join(this.directory, `${requestId(id)}.json`); }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work, work); this.tail = next.catch(() => {}); return next;
  }
  private async directorySafe(): Promise<void> {
    await assertPrivateDirectory(this.directory);
  }
  private async read(id: string, fingerprint?: string): Promise<RequestRecord | undefined> {
    const path = this.path(id);
    let value: unknown;
    try { value = await readBoundedJson(path); }
    catch (error) { if (missing(error)) return undefined; throw error; }
    validate(value, id);
    if (fingerprint !== undefined && value.fingerprint !== fingerprint)
      throw new ArchiveError('request-conflict', 'This request identifier was already used.');
    value.result.counts = counts(value.result.items);
    return value;
  }
  private async write(record: RequestRecord, budget = 8 * 1024 * 1024): Promise<void> {
    await this.directorySafe();
    const encoded = `${JSON.stringify(record)}\n`;
    if (Buffer.byteLength(encoded) > budget)
      throw new ArchiveError('metadata-too-large', 'Recovery metadata is too large. Select a smaller batch.');
    const path = this.path(record.requestId);
    const temporary = `${path}.${randomUUID()}.tmp`;
    const updateIndex = this.indexedDirectory !== undefined && this.indexedDirectory === await this.directoryIdentity();
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(encoded); await handle.sync();
      await handle.close(); handle = undefined;
      await rename(temporary, path);
      await syncDirectory(this.directory);
      if (updateIndex && this.recentIndex) {
        const remaining = this.recentIndex.filter(item => item.id !== record.requestId);
        if (record.complete) remaining.push({ id: record.requestId, mtime: (await lstat(path)).mtimeMs });
        this.recentIndex = this.newest(remaining);
        this.indexedDirectory = await this.directoryIdentity();
      } else this.indexedDirectory = undefined;
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      await unlink(temporary).catch(() => {});
      throw error;
    }
  }
  private async discardTemps(id?: string): Promise<void> {
    const names = await readdir(this.directory); let changed = false;
    for (const name of names) {
      const match = /^(.+)\.json\.(.+)\.tmp$/.exec(name);
      if (!match || !UUID.test(match[1]!) || !UUID.test(match[2]!) || (id !== undefined && match[1] !== id)) continue;
      const path = join(this.directory, name); const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0
        || (typeof process.getuid === 'function' && stat.uid !== process.getuid()))))
        throw new ArchiveError('unsafe-path', 'A temporary request receipt needs attention.');
      await unlink(path); changed = true;
    }
    if (changed) {
      await syncDirectory(this.directory);
    }
  }
  async begin(id: string, fingerprint: string, context: RequestContext, action?: 'cancel'): Promise<RequestRecord> {
    return this.serialize(async () => {
      await this.directorySafe();
      const existing = await this.read(id, fingerprint); if (existing) return existing;
      const record: RequestRecord = { schema: 1, requestId: requestId(id), fingerprint, complete: false,
        ...structuredClone(context), result: { operationId: id, action: action ?? context.preview.action, items: [], counts: counts([]) } };
      // Reserve two MiB for all 100 bounded outcomes before any file transition.
      validate(record, id); await this.write(record, 6 * 1024 * 1024); return structuredClone(record);
    });
  }
  async load(id: string, fingerprint?: string): Promise<RequestRecord | undefined> {
    return this.serialize(async () => { await this.directorySafe(); return this.read(id, fingerprint); });
  }
  async record(id: string, item: ItemResult): Promise<RequestRecord> {
    return this.serialize(async () => {
      await this.directorySafe();
      const record = await this.read(id);
      if (!record) throw new ArchiveError('request-missing', 'The durable request intent is missing.');
      if (!validItem(item)) throw new ArchiveError('invalid-request', 'The request result is invalid.');
      const targets = record.complete ? record.result.items.map(value => value.id) : record.preview!.items.map(value => value.id);
      if (!targets.includes(item.id)) throw new ArchiveError('request-conflict', 'The result does not belong to this request.');
      const merged: ItemResult = { id: item.id, title: record.complete ? '' : item.title.slice(0, 256), status: item.status,
        ...(item.code === undefined ? {} : { code: item.code.slice(0, 80) }),
        ...(item.message === undefined ? {} : { message: item.message.slice(0, 1024) }) };
      const resultById = new Map(record.result.items.map(value => [value.id, value])); resultById.set(item.id, merged);
      record.result.items = targets.flatMap(target => { const value = resultById.get(target); return value ? [value] : []; });
      record.result.counts = counts(record.result.items);
      await this.write(record); return structuredClone(record);
    });
  }
  async complete(id: string, interrupted = false): Promise<BatchResult> {
    return this.serialize(async () => {
      await this.directorySafe();
      const record = await this.read(id);
      if (!record) throw new ArchiveError('request-missing', 'The durable request intent is missing.');
      if (record.complete) { await this.discardTemps(id); return record.result; }
      const saved = new Map(record.result.items.map(item => [item.id, item]));
      const absent = record.preview!.items.filter(item => !saved.has(item.id));
      if (absent.length && !interrupted) throw new ArchiveError('request-incomplete', 'Some request targets have no durable result.');
      for (const item of absent) saved.set(item.id, { id: item.id, title: '', status: 'failed',
        code: 'operation-interrupted', message: 'The operation was interrupted before this target completed. Review it before retrying.' });
      record.result.items = record.preview!.items.map(item => ({ ...saved.get(item.id)!, title: '' }));
      record.result.counts = counts(record.result.items); record.complete = true;
      delete record.preview; delete record.groups; delete record.fingerprints;
      await this.write(record); await this.discardTemps(id); return structuredClone(record.result);
    });
  }
  private async records(): Promise<RequestRecord[]> {
    await this.directorySafe();
    const result: RequestRecord[] = [];
    for (const name of (await readdir(this.directory)).sort()) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -5); requestId(id);
      const record = await this.read(id); if (record) result.push(record);
    }
    return result;
  }
  /** Startup cleanup is explicit. Listing receipts never removes filesystem entries. */
  async cleanTemporaryFiles(): Promise<void> {
    return this.serialize(async () => { await this.directorySafe(); await this.discardTemps(); });
  }
  async incomplete(): Promise<RequestRecord[]> {
    return this.serialize(async () => (await this.records()).filter(record => !record.complete));
  }
  async recent(): Promise<BatchResult[]> {
    return this.serialize(async () => {
      await this.directorySafe();
      const before = await this.directoryIdentity();
      if (!this.recentIndex || this.indexedDirectory !== before) {
        const names = (await readdir(this.directory)).filter(name => name.endsWith('.json'));
        const dated: { id: string; mtime: number }[] = [];
        // Bound filesystem concurrency; old completed receipts remain durable for idempotency.
        for (let start = 0; start < names.length; start += 32) {
          const batch = await Promise.all(names.slice(start, start + 32).map(async name => {
            const id = requestId(name.slice(0, -5));
            try { return { id, mtime: (await lstat(this.path(id))).mtimeMs }; }
            catch (error) { if (missing(error)) return undefined; throw error; }
          }));
          for (const item of batch) if (item) dated.push(item);
        }
        dated.sort((a, b) => b.mtime - a.mtime || a.id.localeCompare(b.id));
        const completed: { id: string; mtime: number }[] = [];
        for (const item of dated) {
          const record = await this.read(item.id);
          if (record?.complete) completed.push(item);
          if (completed.length === 10) break;
        }
        this.recentIndex = completed;
        this.indexedDirectory = before === await this.directoryIdentity() ? before : undefined;
      }
      const recent: BatchResult[] = [];
      // Always validate the actual displayed receipts, including after external edits.
      for (const item of this.recentIndex) {
        const record = await this.read(item.id);
        if (record?.complete) recent.push(record.result);
      }
      return recent;
    });
  }
  private async directoryIdentity(): Promise<string> {
    const stat = await lstat(this.directory, { bigint: true });
    return `${stat.dev}:${stat.ino}:${stat.mtimeNs}:${stat.ctimeNs}`;
  }
  private newest(items: { id: string; mtime: number }[]): { id: string; mtime: number }[] {
    return items.sort((a, b) => b.mtime - a.mtime || a.id.localeCompare(b.id)).slice(0, 10);
  }
}
