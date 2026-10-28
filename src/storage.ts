import { randomUUID, createHash } from 'node:crypto';
import { open, mkdir, lstat, realpath, readdir, readFile, rename, unlink, rmdir } from 'node:fs/promises';
import { basename, dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { ArchiveError, type SessionGroup, type TrashEntry } from './contracts.js';

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
export interface StoreOptions { root: string; sessionsRoot: string }

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (e) { if (isMissing(e)) return false; throw e; }
}
function isMissing(e: unknown): boolean { return !!e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT'; }
function within(root: string, path: string): boolean {
  const p = relative(root, path); return p !== '' && !p.startsWith('..') && !isAbsolute(p);
}
function id(value: string): string {
  if (!UUID.test(value)) throw new ArchiveError('invalid-id', 'Invalid operation or trash identifier.');
  return value;
}
async function plainDirectory(path: string): Promise<void> {
  const st = await lstat(path);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new ArchiveError('unsafe-path', 'A data directory is not a plain directory.');
}
async function privateDirectory(path: string): Promise<void> {
  await plainDirectory(path);
  const st = await lstat(path);
  if ((typeof process.getuid === 'function' && st.uid !== process.getuid()) || (st.mode & 0o022) !== 0)
    throw new ArchiveError('unsafe-path', 'Plugin storage must be owned by this user and not writable by others.');
}
async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
async function atomicJson(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.${randomUUID()}.tmp`;
  const h = await open(tmp, 'wx', 0o600);
  try {
    try { await h.writeFile(`${JSON.stringify(value)}\n`); await h.sync(); } finally { await h.close(); }
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
    || new Set(g.members.map(m => resolve(m.directory))).size !== g.members.length)
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
  constructor(options: StoreOptions) { this.root = resolve(options.root); this.sessionsRoot = resolve(options.sessionsRoot); }
  private area(name: string): string { return join(this.root, name); }
  private operationPath(opId: string): string { return join(this.area('operations'), `${id(opId)}.json`); }
  private stage(entryId: string): string { return join(this.area('staging'), id(entryId)); }
  private entry(entryId: string): string { return join(this.area('trash'), id(entryId)); }

  async initialize(): Promise<void> {
    await plainDirectory(this.sessionsRoot);
    if (within(this.sessionsRoot, this.root) || this.root === this.sessionsRoot)
      throw new ArchiveError('unsafe-path', 'Trash must be outside the session store.');
    if (!await exists(this.root)) await mkdir(this.root, { mode: 0o700, recursive: true });
    await privateDirectory(this.root);
    const canonicalRoot = await realpath(this.root); const canonicalSessions = await realpath(this.sessionsRoot);
    if (within(canonicalSessions, canonicalRoot) || canonicalRoot === canonicalSessions)
      throw new ArchiveError('unsafe-path', 'Trash must be outside the session store.');
    for (const name of ['operations', 'staging', 'trash', 'receipts']) {
      const p = this.area(name); if (!await exists(p)) await mkdir(p, { mode: 0o700 }); await privateDirectory(p);
    }
    if ((await lstat(this.root)).dev !== (await lstat(this.sessionsRoot)).dev)
      throw new ArchiveError('cross-volume', 'Trash and sessions must be on the same volume.');
  }
  private async readJson(path: string): Promise<unknown> {
    const st = await lstat(path);
    if (!st.isFile() || st.isSymbolicLink() || st.size > 8 * 1024 * 1024)
      throw new ArchiveError('corrupt-state', 'Recovery metadata is invalid.');
    try { return JSON.parse(await readFile(path, 'utf8')) as unknown; }
    catch { throw new ArchiveError('corrupt-state', 'Recovery metadata could not be read.'); }
  }
  private async validateSource(group: SessionGroup, allowMissing = false): Promise<void> {
    validateGroup(group);
    if (resolve(group.sessionsRoot) !== this.sessionsRoot) throw new ArchiveError('unsafe-path', 'Session store changed.');
    const root = await realpath(this.sessionsRoot);
    for (const member of group.members) {
      const directory = resolve(member.directory);
      if (!within(this.sessionsRoot, directory) || dirname(dirname(directory)) !== this.sessionsRoot)
        throw new ArchiveError('unsafe-path', 'Session directory is outside the expected layout.');
      await plainDirectory(dirname(directory));
      if (dirname(await realpath(dirname(directory))) !== root)
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
      if (value.schema !== 1 || !UUID.test(value.id) || !UUID.test(value.entryId)
        || basename(this.operationPath(value.id)) !== name
        || !['pending', 'moving', 'detached', 'trashed', 'restoring', 'restored-metadata', 'restored', 'purging', 'purged'].includes(value.phase)
        || !Array.isArray(value.moved) || value.moved.some(n => !Number.isInteger(n) || n < 0 || n >= value.group.members.length)
        || (value.requestId !== undefined && (!UUID.test(value.requestId) || typeof value.targetId !== 'string')))
        throw new ArchiveError('corrupt-state', 'Unknown operation journal.');
      validateGroup(value.group); await this.validateSource(value.group, true); result.push(value);
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
    if (!await exists(path)) return true;
    await this.validateContainer(path, op.group, true);
    for (let i = 0; i < op.group.members.length; i++) if (await exists(join(path, String(i)))) return false;
    await unlink(join(path, 'manifest.json')).catch(e => { if (!isMissing(e)) throw e; }); await rmdir(path);
    return true;
  }
  async manifest(entryId: string): Promise<Manifest> {
    const directory = this.entry(entryId); await plainDirectory(directory);
    const m = await this.readJson(join(directory, 'manifest.json')) as Manifest;
    if (m.schema !== 1 || m.id !== entryId || !Number.isFinite(m.trashedAt)) throw new ArchiveError('corrupt-state', 'Invalid trash manifest.');
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
  async entryFingerprint(entryId: string): Promise<string> {
    const manifest = await this.manifest(entryId);
    const hash = createHash('sha256').update(JSON.stringify(manifest));
    for (let i = 0; i < manifest.group.members.length; i++) {
      const directory = join(this.entry(entryId), String(i));
      if (!await exists(directory)) { hash.update(`missing:${i}`); continue; }
      for (const name of (await readdir(directory)).sort()) {
        if (name === 'session.lock') continue;
        const st = await lstat(join(directory, name), { bigint: true });
        hash.update(`${i}:${name}:${st.dev}:${st.ino}:${st.size}:${st.mtimeNs}`);
      }
    }
    return hash.digest('hex');
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
    if (!await exists(this.area('trash'))) return [];
    const entries: TrashEntry[] = [];
    for (const key of await readdir(this.area('trash'))) {
      if (!UUID.test(key)) throw new ArchiveError('corrupt-state', 'An unknown trash entry needs attention.');
      const journals = (await this.operations()).filter(o => o.entryId === key);
      if (journals.some(o => o.phase === 'restored-metadata' || o.phase === 'restored')) continue;
      if (!await exists(join(this.entry(key), 'manifest.json')) && journals.some(o => o.phase === 'purging' || o.phase === 'purged')) continue;
      const m = await this.manifest(key);
      entries.push({ id: key, sessionId: m.group.sessionId, title: m.group.title, trashedAt: m.trashedAt,
        sizeBytes: m.group.members.reduce((n, s) => n + s.sizeBytes, 0), memberCount: m.group.members.length });
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
    const directory = this.entry(entryId); await plainDirectory(directory);
    const m = await this.readJson(join(directory, 'manifest.json')) as Manifest;
    if (m.schema !== 1 || m.id !== entryId) throw new ArchiveError('corrupt-state', 'Invalid trash manifest.');
    validateGroup(m.group); await this.validateSource(m.group, true);
    await this.validateContainer(directory, m.group, true);
    const op: Operation = { schema: 1, id: randomUUID(), entryId, phase: 'purging', group: m.group, createdAt: Date.now(), moved: [], ...context };
    await this.writeOperation(op);
    for (let i = 0; i < m.group.members.length; i++) {
      const p = join(directory, String(i)); if (!await exists(p)) continue;
      for (const file of await readdir(p)) await unlink(join(p, file));
      await rmdir(p);
    }
    await unlink(join(directory, 'manifest.json')); await rmdir(directory); await syncDirectory(this.area('trash'));
    op.phase = 'purged'; await this.writeOperation(op); return op;
  }
}
