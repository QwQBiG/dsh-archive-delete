import { randomUUID, createHash } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { open, mkdir, lstat, realpath, readdir, rename, unlink, rmdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { ArchiveError, type DataIssue, type SessionGroup, type TrashEntry } from './contracts.js';
import { assertCanonicalStoragePath, assertLocalStoragePath, assertPlainDirectory as plainDirectory, assertPrivateDirectory as privateDirectory,
  isWithin as within, readBoundedJson, samePath, syncDirectory } from './filesystem.js';

const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const LOG = /^session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/;
const TEMP = /^(?:session\.migration\.[\w.-]+\.tmp|session(?:\.v\d+)?\.jsonl(?:\.zstd)?\.[a-f\d]+\.tmp)$/i;
type Phase = 'pending' | 'moving' | 'detached' | 'trashed' | 'restoring' | 'restored-metadata' | 'restored' | 'purging' | 'purged';
export interface OperationContext { requestId: string; targetId: string }
export interface Operation {
  schema: 1; id: string; entryId: string; phase: Phase; group: SessionGroup;
  createdAt: number; moved: number[]; reason?: string;
  requestId?: string; targetId?: string;
}
export interface Manifest { schema: 1; id: string; group: SessionGroup; trashedAt: number }
export interface EntrySnapshot { manifest: Manifest; sizeBytes: number; logBytes: number; fileCount: number; fingerprint: string }
export interface StoreOptions { root: string; sessionsRoot: string }

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (e) { if (isMissing(e)) return false; throw e; }
}
function isMissing(e: unknown): boolean { return !!e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT'; }
function id(value: string): string {
  if (!UUID.test(value)) throw new ArchiveError('invalid-id', 'Invalid operation or trash identifier.');
  return value;
}
function sessionDirectoryName(value: string): string {
  if (value === '.') return '~002E';
  if (value === '..') return '~002E~002E';
  return value.replace(/[^A-Za-z0-9._-]/g, character => `~${character.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
}
async function atomicJson(path: string, value: unknown): Promise<void> {
  const encoded = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(encoded) > 8 * 1024 * 1024)
    throw new ArchiveError('metadata-too-large', 'Recovery metadata is too large. Select a smaller batch.');
  const tmp = `${path}.${randomUUID()}.tmp`;
  const h = await open(tmp, 'wx', 0o600);
  try {
    try { await h.writeFile(encoded); await h.sync(); } finally { await h.close(); }
    await rename(tmp, path); await syncDirectory(dirname(path));
  } catch (e) { await unlink(tmp).catch(() => {}); throw e; }
}
function validateGroup(value: unknown): asserts value is SessionGroup {
  if (!value || typeof value !== 'object') throw new ArchiveError('corrupt-state', 'Invalid recovery metadata.');
  const g = value as SessionGroup;
  if (typeof g.sessionId !== 'string' || typeof g.title !== 'string' || typeof g.sessionsRoot !== 'string'
    || !Array.isArray(g.members) || !g.members.length || g.members.length > 1000
    || g.members.some(m => !m || typeof m.id !== 'string' || typeof m.directory !== 'string'
      || typeof m.revision !== 'string' || typeof m.title !== 'string' || !m.header || typeof m.header !== 'object'))
    throw new ArchiveError('corrupt-state', 'Invalid recovery metadata.');
  if (new Set(g.members.map(m => m.id)).size !== g.members.length
    || new Set(g.members.map(m => process.platform === 'win32' ? resolve(m.directory).toLowerCase() : resolve(m.directory))).size !== g.members.length)
    throw new ArchiveError('corrupt-state', 'Recovery targets are ambiguous.');
  if (!g.members.some(m => m.id === g.sessionId) || g.members.some(m => m.header.id !== m.id
    || typeof m.archived !== 'boolean' || !Array.isArray(m.activity) || !Number.isFinite(m.sizeBytes) || m.sizeBytes < 0))
    throw new ArchiveError('corrupt-state', 'Recovery identities do not match.');
}
export function groupFingerprint(group: SessionGroup): string {
  return createHash('sha256').update(JSON.stringify({ root: resolve(group.sessionsRoot), sessionId: group.sessionId,
    members: group.members.map(m => ({ id: m.id, directory: resolve(m.directory), revision: m.revision,
      archived: m.archived, header: m.header })).sort((a, b) => a.id.localeCompare(b.id)) })).digest('hex');
}

/** Owns only this plugin's journals and trash; never follows a supplied path. */
export class TrashStore {
  readonly root: string;
  readonly sessionsRoot: string;
  private issues: DataIssue[] = [];
  constructor(options: StoreOptions) { this.root = resolve(options.root); this.sessionsRoot = resolve(options.sessionsRoot); }
  private area(name: string): string { return join(this.root, name); }
  private operationPath(opId: string): string { return join(this.area('operations'), `${id(opId)}.json`); }
  private stage(entryId: string): string { return join(this.area('staging'), id(entryId)); }
  private entry(entryId: string): string { return join(this.area('trash'), id(entryId)); }
  listIssues(): readonly DataIssue[] { return this.issues; }
  private async sync(path: string): Promise<void> { await syncDirectory(path); }

  async initialize(): Promise<void> {
    assertLocalStoragePath(this.root); assertLocalStoragePath(this.sessionsRoot);
    await plainDirectory(this.sessionsRoot);
    if (within(this.sessionsRoot, this.root) || samePath(this.root, this.sessionsRoot))
      throw new ArchiveError('unsafe-path', 'Trash must be outside the session store.');
    const createdRoot = !await exists(this.root) ? await mkdir(this.root, { mode: 0o700, recursive: true }) : undefined;
    await privateDirectory(this.root);
    const canonicalRoot = await realpath(this.root); const canonicalSessions = await realpath(this.sessionsRoot);
    assertLocalStoragePath(canonicalRoot); assertLocalStoragePath(canonicalSessions);
    await assertCanonicalStoragePath(this.root, canonicalRoot); await assertCanonicalStoragePath(this.sessionsRoot, canonicalSessions);
    if (within(canonicalSessions, canonicalRoot) || samePath(canonicalRoot, canonicalSessions))
      throw new ArchiveError('unsafe-path', 'Trash must be outside the session store.');
    for (const name of ['operations', 'staging', 'trash', 'receipts']) {
      const p = this.area(name); if (!await exists(p)) await mkdir(p, { mode: 0o700 }); await privateDirectory(p);
    }
    // Journals and staged moves depend on these directories remaining reachable.
    // Recursive creation reports its first new ancestor; publish that chain too.
    await this.sync(this.root);
    if (createdRoot) {
      for (let path = this.root; !samePath(path, createdRoot); path = dirname(path)) await this.sync(dirname(path));
      await this.sync(dirname(createdRoot));
    } else await this.sync(dirname(this.root));
    if ((await lstat(this.root)).dev !== (await lstat(this.sessionsRoot)).dev)
      throw new ArchiveError('cross-volume', 'Trash and sessions must be on the same volume.');
  }
  private async readJson(path: string): Promise<unknown> {
    return readBoundedJson(path);
  }
  private async validateSource(group: SessionGroup, allowMissing = false): Promise<void> {
    validateGroup(group);
    assertLocalStoragePath(group.sessionsRoot);
    if (!samePath(group.sessionsRoot, this.sessionsRoot)) throw new ArchiveError('unsafe-path', 'Session store changed.');
    await plainDirectory(this.sessionsRoot);
    const root = await realpath(this.sessionsRoot);
    for (const member of group.members) {
      assertLocalStoragePath(member.directory);
      const directory = resolve(member.directory);
      if (!within(this.sessionsRoot, directory) || !samePath(dirname(dirname(directory)), this.sessionsRoot) || basename(directory) !== sessionDirectoryName(member.id))
        throw new ArchiveError('unsafe-path', 'Session directory is outside the expected layout.');
      try { await plainDirectory(dirname(directory)); }
      catch (error) {
        // Recovery and cancellation may outlive an empty source bucket. An
        // existing redirected/unsafe bucket still fails the normal checks.
        if (allowMissing && isMissing(error)) continue;
        throw error;
      }
      const canonicalParent = await realpath(dirname(directory)); assertLocalStoragePath(canonicalParent);
      if (!samePath(dirname(canonicalParent), root))
        throw new ArchiveError('unsafe-path', 'Session parent directory is unsafe.');
      if (!await exists(directory)) { if (allowMissing) continue; throw new ArchiveError('missing-session', 'Session data no longer exists.'); }
      if ((await lstat(directory)).dev !== (await lstat(this.root)).dev)
        throw new ArchiveError('cross-volume', 'Session data and trash must be on the same volume.');
      await this.validateContents(directory);
    }
  }
  private async validateContents(directory: string): Promise<string[]> {
    await plainDirectory(directory);
    const names = await readdir(directory);
    let logs = 0;
    for (const name of names) {
      if (!(LOG.test(name) || TEMP.test(name) || name === 'session.lock'))
        throw new ArchiveError('unknown-file', 'An unexpected file prevents this operation.');
      const s = await lstat(join(directory, name));
      if (!s.isFile() || s.isSymbolicLink()) throw new ArchiveError('unsafe-path', 'Session data contains an unsafe entry.');
      if (LOG.test(name)) logs++;
    }
    if (!logs) throw new ArchiveError('missing-log', 'The session log is missing.');
    return names;
  }
  private async writeOperation(operation: Operation): Promise<void> { await atomicJson(this.operationPath(operation.id), operation); }
  async cleanTemporaryFiles(): Promise<void> {
    const clean = async (directory: string) => {
      await privateDirectory(directory);
      for (const name of await readdir(directory)) {
        if (!/^(?:[a-f\d-]{36}\.json|manifest\.json)\.[a-f\d-]{36}\.tmp$/i.test(name)) continue;
        const path = join(directory, name); const st = await lstat(path);
        if (!st.isFile() || st.isSymbolicLink()) throw new ArchiveError('unsafe-path', 'A recovery temporary is unsafe.');
        await unlink(path);
      }
    };
    for (const area of ['operations', 'receipts']) await clean(this.area(area));
    for (const area of ['staging', 'trash']) for (const entry of await readdir(this.area(area))) {
      if (UUID.test(entry)) await clean(join(this.area(area), entry));
    }
  }
  async operations(): Promise<Operation[]> {
    if (!await exists(this.area('operations'))) return [];
    const result: Operation[] = [];
    for (const name of (await readdir(this.area('operations'))).sort()) {
      if (!name.endsWith('.json')) continue;
      const value = await this.readJson(join(this.area('operations'), name)) as Operation;
      if (!value || typeof value !== 'object') throw new ArchiveError('corrupt-state', 'Unknown operation journal.');
      validateGroup(value.group);
      if (value.schema !== 1 || !UUID.test(value.id) || !UUID.test(value.entryId)
        || basename(this.operationPath(value.id)) !== name
        || !['pending', 'moving', 'detached', 'trashed', 'restoring', 'restored-metadata', 'restored', 'purging', 'purged'].includes(value.phase)
        || !Array.isArray(value.moved) || value.moved.some(n => !Number.isInteger(n) || n < 0 || n >= value.group.members.length)
        || (value.requestId !== undefined && (!UUID.test(value.requestId) || typeof value.targetId !== 'string')))
        throw new ArchiveError('corrupt-state', 'Unknown operation journal.');
      await this.validateSource(value.group, true); result.push(value);
    }
    return result;
  }
  async queue(group: SessionGroup, reason: string, context?: OperationContext): Promise<void> {
    const pending = (await this.operations()).find(o => o.phase === 'pending' && o.group.sessionId === group.sessionId);
    if (pending) return;
    const key = randomUUID();
    await this.writeOperation({ schema: 1, id: key, entryId: key, phase: 'pending', group, createdAt: Date.now(), moved: [], reason, ...context });
  }
  async cancelPending(sessionId: string): Promise<boolean> {
    const pending = (await this.operations()).filter(o => o.phase === 'pending' && o.group.sessionId === sessionId);
    for (const op of pending) await this.finish(op);
    return pending.length > 0;
  }
  async prepareTrash(group: SessionGroup, pending?: Operation, context?: OperationContext): Promise<Operation> {
    await this.validateSource(group);
    const key = pending?.id ?? randomUUID();
    const op: Operation = { schema: 1, id: key, entryId: pending?.entryId ?? key, phase: 'moving', group, createdAt: pending?.createdAt ?? Date.now(), moved: [],
      ...(pending?.requestId ? { requestId: pending.requestId, targetId: pending.targetId! } : context) };
    await this.writeOperation(op);
    const stage = this.stage(op.entryId);
    if (await exists(stage) || await exists(this.entry(op.entryId))) throw new ArchiveError('conflict', 'A trash entry already exists.');
    await mkdir(stage, { mode: 0o700 });
    // Publish the staging directory before a source rename can depend on it.
    await this.sync(this.area('staging'));
    await atomicJson(join(stage, 'manifest.json'), { schema: 1, id: op.entryId, group, trashedAt: Date.now() } satisfies Manifest);
    for (const [i, member] of group.members.entries()) {
      await rename(member.directory, join(stage, String(i)));
      await syncDirectory(dirname(member.directory)); await syncDirectory(stage);
      op.moved.push(i); await this.writeOperation(op);
    }
    return op;
  }
  async markDetached(op: Operation): Promise<void> { op.phase = 'detached'; await this.writeOperation(op); }
  async commitTrash(op: Operation): Promise<void> {
    await rename(this.stage(op.entryId), this.entry(op.entryId));
    await syncDirectory(this.area('trash')); await syncDirectory(this.area('staging'));
    op.phase = 'trashed'; await this.writeOperation(op);
  }
  async rollbackTrash(op: Operation): Promise<void> {
    await this.validateSource(op.group, true);
    const stage = this.stage(op.entryId);
    if (!await exists(stage)) {
      if (await exists(this.entry(op.entryId))) throw new ArchiveError('already-committed', 'The trash move is already committed.');
      for (const m of op.group.members) if (!await exists(m.directory)) throw new ArchiveError('recovery-required', 'Recovery needs attention.');
      return;
    }
    await this.validateContainer(stage, op.group);
    for (let i = op.group.members.length - 1; i >= 0; i--) {
      const m = op.group.members[i]!; const staged = join(stage, String(i));
      if (!await exists(staged)) continue;
      if (await exists(m.directory)) throw new ArchiveError('restore-conflict', 'Recovery would overwrite existing session data.');
      await rename(staged, m.directory); await syncDirectory(dirname(m.directory));
    }
    await unlink(join(stage, 'manifest.json')).catch(e => { if (!isMissing(e)) throw e; });
    await rmdir(stage); await syncDirectory(this.area('staging'));
  }
  async finish(op: Operation): Promise<void> { await unlink(this.operationPath(op.id)).catch(e => { if (!isMissing(e)) throw e; }); await syncDirectory(this.area('operations')); }
  async hasEntry(entryId: string): Promise<boolean> { return exists(this.entry(entryId)); }
  async assertCommittedTrash(op: Operation): Promise<void> {
    const manifest = await this.manifest(op.entryId);
    if (groupFingerprint(manifest.group) !== groupFingerprint(op.group) || await exists(this.stage(op.entryId)))
      throw new ArchiveError('corrupt-state', 'The committed trash entry does not match its operation.');
    for (const [i, member] of op.group.members.entries()) {
      await this.validateContents(join(this.entry(op.entryId), String(i)));
      if (await exists(member.directory)) throw new ArchiveError('restore-conflict', 'The original session still exists. Recovery needs attention.');
    }
  }
  async locations(op: Operation): Promise<(string | undefined)[]> {
    await this.validateSource(op.group, true);
    const locations: (string | undefined)[] = [];
    for (const [i, member] of op.group.members.entries()) {
      const candidates = [member.directory, join(this.stage(op.entryId), String(i)), join(this.entry(op.entryId), String(i))];
      const found: string[] = [];
      for (const path of candidates) if (await exists(path)) { await plainDirectory(path); found.push(path); }
      if (found.length > 1) throw new ArchiveError('restore-conflict', 'Recovery found conflicting copies of a session.');
      locations.push(found[0]);
    }
    return locations;
  }
  async entryLocations(entryId: string): Promise<(string | undefined)[]> {
    const m = await this.manifest(entryId);
    const paths: (string | undefined)[] = [];
    for (let i = 0; i < m.group.members.length; i++) { const p = join(this.entry(entryId), String(i)); paths.push(await exists(p) ? p : undefined); }
    return paths;
  }
  async completeEmptyPurge(op: Operation): Promise<boolean> {
    const path = this.entry(op.entryId);
    if (!await exists(path)) { await this.sync(this.area('trash')); return true; }
    const unchanged = await this.directoryGuard(path);
    await this.validateContainer(path, op.group, true);
    for (let i = 0; i < op.group.members.length; i++) if (await exists(join(path, String(i)))) return false;
    if (await exists(join(path, 'manifest.json'))) {
      const manifest = await this.manifest(op.entryId);
      if (groupFingerprint(manifest.group) !== groupFingerprint(op.group))
        throw new ArchiveError('corrupt-state', 'The interrupted deletion does not match its trash manifest.');
    }
    await unchanged();
    // Make removed member entries durable before discarding their manifest.
    await this.sync(path);
    await unchanged();
    await this.assertEmptyEntry(path);
    await unlink(join(path, 'manifest.json')).catch(e => { if (!isMissing(e)) throw e; });
    await this.sync(path); await unchanged(); await rmdir(path); await this.sync(this.area('trash'));
    return true;
  }
  async manifest(entryId: string): Promise<Manifest> {
    const directory = this.entry(entryId); await plainDirectory(directory);
    let m: Manifest;
    try { m = await this.readJson(join(directory, 'manifest.json')) as Manifest; }
    catch (error) {
      if (isMissing(error)) throw new ArchiveError('corrupt-state', 'The trash manifest is missing. Its remaining data was left untouched.');
      throw error;
    }
    if (!m || m.schema !== 1 || m.id !== entryId || !Number.isFinite(m.trashedAt)) throw new ArchiveError('corrupt-state', 'Invalid trash manifest.');
    validateGroup(m.group); await this.validateSource(m.group, true); await this.validateContainer(directory, m.group, true);
    return m;
  }
  async checkRestore(entryId: string): Promise<void> {
    if ((await this.operations()).some(o => o.entryId === entryId && o.phase === 'purging'))
      throw new ArchiveError('purge-interrupted', 'Permanent deletion began for this entry. Only an explicit purge retry is available.');
    const manifest = await this.manifest(entryId);
    for (const [i, member] of manifest.group.members.entries()) {
      await this.validateContents(join(this.entry(entryId), String(i)));
      if (await exists(member.directory)) throw new ArchiveError('restore-conflict', 'The original session location is already occupied.');
    }
  }
  async entrySnapshot(entryId: string): Promise<EntrySnapshot> {
    return this.measureEntry(entryId, await this.operations());
  }
  private async measureEntry(entryId: string, operations: readonly Operation[]): Promise<EntrySnapshot> {
    const entry = this.entry(entryId); const manifestPath = join(entry, 'manifest.json');
    const signature = (st: BigIntStats) => `${st.dev}:${st.ino}:${st.mode}:${st.size}:${st.mtimeNs}:${st.ctimeNs}`;
    const identity = (st: BigIntStats) => `${st.dev}:${st.ino}:${st.mode}`;
    const changed = () => new ArchiveError('source-changed', 'Trash data changed while measuring it. Review the entry again.');
    const entryBefore = await lstat(entry, { bigint: true });
    const manifestBefore = await lstat(manifestPath, { bigint: true });
    if (!manifestBefore.isFile() || manifestBefore.isSymbolicLink()) throw new ArchiveError('unsafe-path', 'The trash manifest is unsafe.');
    const manifest = await this.manifest(entryId);
    const entryNames = (await readdir(entry)).sort(); const allowed = new Set(['manifest.json', ...manifest.group.members.map((_, i) => String(i))]);
    if (entryNames.some(name => !allowed.has(name))) throw new ArchiveError('unknown-file', 'Unexpected data prevents measuring this entry.');
    const partial = operations.some(operation => operation.entryId === entryId
      && ['purging', 'purged'].includes(operation.phase) && groupFingerprint(operation.group) === groupFingerprint(manifest.group));
    const hash = createHash('sha256').update(JSON.stringify(manifest));
    const observed: { path: string; signature: string }[] = [];
    const members: { path: string; identity?: string; names: string[] }[] = [];
    let size = 0n; let logs = 0n;
    for (let i = 0; i < manifest.group.members.length; i++) {
      const directory = join(entry, String(i));
      if (!await exists(directory)) {
        if (!partial) throw new ArchiveError('corrupt-state', 'A trash member is missing without a permanent deletion journal.');
        hash.update(`missing:${i}`); members.push({ path: directory, names: [] }); continue;
      }
      const directoryBefore = await lstat(directory, { bigint: true });
      if (!directoryBefore.isDirectory() || directoryBefore.isSymbolicLink()) throw new ArchiveError('unsafe-path', 'A trash member is unsafe.');
      const names = (await readdir(directory)).sort(); let logCount = 0;
      hash.update(`present:${i}`);
      members.push({ path: directory, identity: identity(directoryBefore), names: names.filter(name => name !== 'session.lock') });
      for (const name of names) {
        if (!(LOG.test(name) || TEMP.test(name) || name === 'session.lock')) throw new ArchiveError('unknown-file', 'Unexpected data prevents measuring this entry.');
        const path = join(directory, name); const st = await lstat(path, { bigint: true });
        if (!st.isFile() || st.isSymbolicLink()) throw new ArchiveError('unsafe-path', 'A trash file is unsafe.');
        if (name === 'session.lock') continue;
        if (st.size < 0n) throw new ArchiveError('corrupt-state', 'A trash file has an invalid size.');
        observed.push({ path, signature: signature(st) }); size += st.size;
        if (LOG.test(name)) { logs += st.size; logCount++; }
        hash.update(`${i}:${name}:${signature(st)}`);
      }
      if (!partial && !logCount) throw new ArchiveError('missing-log', 'The trash member log is missing.');
    }
    if (size > BigInt(Number.MAX_SAFE_INTEGER)) throw new ArchiveError('corrupt-state', 'Trash file sizes exceed the supported range.');
    try {
      const finalManifest = await this.manifest(entryId);
      if (JSON.stringify(finalManifest) !== JSON.stringify(manifest)
        || signature(await lstat(manifestPath, { bigint: true })) !== signature(manifestBefore)
        || identity(await lstat(entry, { bigint: true })) !== identity(entryBefore)) throw changed();
      for (const member of members) {
        if (member.identity === undefined) { if (await exists(member.path)) throw changed(); continue; }
        const st = await lstat(member.path, { bigint: true });
        if (!st.isDirectory() || st.isSymbolicLink() || identity(st) !== member.identity
          || JSON.stringify((await readdir(member.path)).filter(name => name !== 'session.lock').sort()) !== JSON.stringify(member.names)) throw changed();
      }
      for (const file of observed) {
        const st = await lstat(file.path, { bigint: true });
        if (!st.isFile() || st.isSymbolicLink() || signature(st) !== file.signature) throw changed();
      }
      if (signature(await lstat(manifestPath, { bigint: true })) !== signature(manifestBefore)
        || JSON.stringify((await readdir(entry)).sort()) !== JSON.stringify(entryNames)) throw changed();
    } catch { throw changed(); }
    return { manifest, sizeBytes: Number(size), logBytes: Number(logs), fileCount: observed.length, fingerprint: hash.digest('hex') };
  }
  async entryFingerprint(entryId: string): Promise<string> {
    return (await this.entrySnapshot(entryId)).fingerprint;
  }
  private async validateContainer(directory: string, group: SessionGroup, allowPartial = false): Promise<void> {
    await plainDirectory(directory);
    const allowed = new Set(['manifest.json', ...group.members.map((_, i) => String(i))]);
    for (const name of await readdir(directory)) {
      if (!allowed.has(name)) throw new ArchiveError('unknown-file', 'An unexpected trash entry prevents this operation.');
      if (name !== 'manifest.json') {
        const p = join(directory, name);
        if (allowPartial) await this.validatePartialContents(p); else await this.validateContents(p);
      }
    }
  }
  private async validatePartialContents(directory: string): Promise<void> {
    await plainDirectory(directory);
    for (const name of await readdir(directory)) {
      const st = await lstat(join(directory, name));
      if (!(LOG.test(name) || TEMP.test(name) || name === 'session.lock') || !st.isFile() || st.isSymbolicLink())
        throw new ArchiveError('unknown-file', 'Unexpected data prevents permanent deletion.');
    }
  }
  async list(): Promise<TrashEntry[]> {
    this.issues = [];
    if (!await exists(this.area('trash'))) return [];
    await privateDirectory(this.area('trash'));
    const entries: TrashEntry[] = [];
    const operations = await this.operations();
    const byEntry = new Map<string, Operation[]>();
    for (const operation of operations) {
      const group = byEntry.get(operation.entryId) ?? [];
      group.push(operation); byEntry.set(operation.entryId, group);
    }
    for (const key of await readdir(this.area('trash'))) {
      try {
        if (!UUID.test(key)) throw new ArchiveError('corrupt-state', 'An unknown trash entry needs attention. Its data was left untouched.');
        const journals = byEntry.get(key) ?? [];
        await plainDirectory(this.entry(key));
        if (journals.some(o => o.phase === 'restored-metadata' || o.phase === 'restored')) continue;
        if (!await exists(join(this.entry(key), 'manifest.json')) && journals.some(o => o.phase === 'purging' || o.phase === 'purged')) {
          await this.assertEmptyEntry(this.entry(key)); continue;
        }
        const { manifest: m, sizeBytes } = await this.measureEntry(key, journals);
        entries.push({ id: key, sessionId: m.group.sessionId, title: m.group.title, trashedAt: m.trashedAt,
          sizeBytes, memberCount: m.group.members.length });
      } catch (error) {
        const detail = error instanceof ArchiveError ? error : isMissing(error)
          ? new ArchiveError('corrupt-state', 'A trash entry is incomplete. Its remaining data was left untouched.')
          : new ArchiveError('entry-unavailable', 'A trash entry could not be read. Its data was left untouched.');
        this.issues.push({ scope: 'trash', id: key, code: detail.code, message: detail.message });
      }
    }
    return entries.sort((a, b) => b.trashedAt - a.trashedAt);
  }
  async prepareRestore(entryId: string, context?: OperationContext): Promise<Operation> {
    await this.checkRestore(entryId);
    const manifest = await this.manifest(entryId);
    for (const member of manifest.group.members) if (await exists(member.directory))
      throw new ArchiveError('restore-conflict', 'The original session location is already occupied.');
    const op: Operation = { schema: 1, id: randomUUID(), entryId, phase: 'restoring', group: manifest.group, createdAt: Date.now(), moved: [], ...context };
    await this.writeOperation(op);
    for (const [i, member] of op.group.members.entries()) {
      const path = join(this.entry(entryId), String(i)); await this.validateContents(path);
      await rename(path, member.directory); await syncDirectory(dirname(member.directory)); await syncDirectory(this.entry(entryId));
      op.moved.push(i); await this.writeOperation(op);
    }
    return op;
  }
  async markRestored(op: Operation): Promise<void> { op.phase = 'restored-metadata'; await this.writeOperation(op); }
  async commitRestore(op: Operation): Promise<void> {
    const entry = this.entry(op.entryId);
    if (await exists(entry)) {
      await this.validateContainer(entry, op.group, true);
      await unlink(join(entry, 'manifest.json')).catch(e => { if (!isMissing(e)) throw e; }); await rmdir(entry);
    }
    await syncDirectory(this.area('trash')); op.phase = 'restored'; await this.writeOperation(op);
  }
  async rollbackRestore(op: Operation): Promise<void> {
    await this.validateSource(op.group, true);
    const entry = this.entry(op.entryId); await this.validateContainer(entry, op.group);
    for (let i = op.group.members.length - 1; i >= 0; i--) {
      const member = op.group.members[i]!; const target = join(entry, String(i));
      if (await exists(target)) continue;
      await this.validateContents(member.directory);
      await rename(member.directory, target); await syncDirectory(entry); await syncDirectory(dirname(member.directory));
    }
  }
  async purge(entryId: string, context?: OperationContext): Promise<Operation> {
    // Partial purges remain retryable; no recursive rm can cross an unexpected entry.
    const directory = this.entry(entryId); const unchanged = await this.directoryGuard(directory);
    const m = await this.readJson(join(directory, 'manifest.json')) as Manifest;
    if (!m || m.schema !== 1 || m.id !== entryId) throw new ArchiveError('corrupt-state', 'Invalid trash manifest.');
    validateGroup(m.group); await this.validateSource(m.group, true);
    await this.validateContainer(directory, m.group, true);
    const members: { path: string; unchanged: () => Promise<void> }[] = [];
    for (let i = 0; i < m.group.members.length; i++) {
      const path = join(directory, String(i));
      if (await exists(path)) members.push({ path, unchanged: await this.directoryGuard(path) });
    }
    const op: Operation = { schema: 1, id: randomUUID(), entryId, phase: 'purging', group: m.group, createdAt: Date.now(), moved: [], ...context };
    await this.writeOperation(op);
    for (const member of members) {
      await unchanged(); await member.unchanged();
      for (const file of await readdir(member.path)) {
        const path = join(member.path, file); const st = await lstat(path);
        if (!(LOG.test(file) || TEMP.test(file) || file === 'session.lock') || !st.isFile() || st.isSymbolicLink())
          throw new ArchiveError('unknown-file', 'Unexpected data prevents permanent deletion.');
        await unchanged(); await member.unchanged(); await unlink(path);
      }
      await unchanged(); await member.unchanged(); await this.sync(member.path);
      await unchanged(); await member.unchanged(); await rmdir(member.path);
      await this.sync(directory);
    }
    await unchanged(); await this.sync(directory);
    await unchanged(); await this.assertEmptyEntry(directory);
    await unlink(join(directory, 'manifest.json')); await this.sync(directory);
    await unchanged(); await rmdir(directory); await this.sync(this.area('trash'));
    op.phase = 'purged'; await this.writeOperation(op); return op;
  }
  private async assertEmptyEntry(directory: string): Promise<void> {
    if ((await readdir(directory)).some(name => name !== 'manifest.json'))
      throw new ArchiveError('unknown-file', 'Unexpected data remains in the trash entry. Its manifest was retained.');
  }
  /** Recheck each owned directory immediately before path-based deletion. Node
   * has no portable unlinkat; this does not promise immunity to a same-user
   * adversary changing a parent during the final filesystem syscall. */
  private async directoryGuard(path: string): Promise<() => Promise<void>> {
    const before = await lstat(path, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink())
      throw new ArchiveError('unsafe-path', 'A trash directory is unsafe.');
    const canonical = await realpath(path); await assertCanonicalStoragePath(path, canonical);
    const check = async () => {
      const current = await lstat(path, { bigint: true });
      if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== before.dev || current.ino !== before.ino
        || !samePath(await realpath(path), canonical))
        throw new ArchiveError('unsafe-path', 'A trash directory changed during permanent deletion.');
    };
    await check(); return check;
  }
}
