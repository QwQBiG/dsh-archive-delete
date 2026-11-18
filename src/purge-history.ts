import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, realpath, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ArchiveError } from './contracts.js';
import { assertCanonicalStoragePath, assertLocalStoragePath, assertPrivateDirectory, readBoundedJson, samePath, syncDirectory } from './filesystem.js';
import type { Operation } from './storage.js';

export interface PurgeHistoryEntry {
  entryId: string;
  sessionId: string;
  titleHash: string;
  sizeBytes: number;
  memberCount: number;
  purgedAt: number;
  requestId?: string;
}
export interface PurgeHistoryOptions { warn?(message: string): void; now?(): number }
const MAX_ENTRIES = 200;
const MAX_AGE_MS = 30 * 24 * 60 * 60_000;
const MAX_BYTES = 512 * 1024;
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const KEYS = new Set(['entryId', 'sessionId', 'titleHash', 'sizeBytes', 'memberCount', 'purgedAt', 'requestId']);
function missing(error: unknown): boolean { return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'; }
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function validEntry(value: unknown): value is PurgeHistoryEntry {
  return object(value) && Object.keys(value).every(key => KEYS.has(key))
    && typeof value.entryId === 'string' && UUID.test(value.entryId)
    && typeof value.sessionId === 'string' && value.sessionId.length > 0 && value.sessionId.length <= 512 && !value.sessionId.includes('\0')
    && typeof value.titleHash === 'string' && /^[a-f\d]{64}$/.test(value.titleHash)
    && Number.isSafeInteger(value.sizeBytes) && (value.sizeBytes as number) >= 0
    && Number.isSafeInteger(value.memberCount) && (value.memberCount as number) >= 1 && (value.memberCount as number) <= 1000
    && Number.isSafeInteger(value.purgedAt) && (value.purgedAt as number) >= 0 && (value.purgedAt as number) <= 8_640_000_000_000_000
    && (value.requestId === undefined || (typeof value.requestId === 'string' && UUID.test(value.requestId)));
}

/** Small informational evidence, separate from the authoritative recovery journal. */
export class PurgeHistory {
  private readonly root: string;
  private readonly directory: string;
  private readonly path: string;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(root: string, private readonly options: PurgeHistoryOptions = {}) {
    this.root = resolve(root); this.directory = join(this.root, 'purge-history'); this.path = join(this.directory, 'history.json');
  }
  private warn(): void {
    try { this.options.warn?.('[archive-delete] Purge history unavailable: reason=purge-history-storage.'); }
    catch { /* Informational evidence cannot change a completed deletion. */ }
  }
  private now(): number { return this.options.now?.() ?? Date.now(); }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work, work); this.tail = next.catch(() => {}); return next;
  }
  private retained(entries: PurgeHistoryEntry[]): PurgeHistoryEntry[] {
    const cutoff = this.now() - MAX_AGE_MS;
    return entries.filter(entry => entry.purgedAt >= cutoff).sort((a, b) => b.purgedAt - a.purgedAt || a.entryId.localeCompare(b.entryId)).slice(0, MAX_ENTRIES);
  }
  private async directoryGuard(create: boolean): Promise<(() => Promise<void>) | undefined> {
    assertLocalStoragePath(this.root);
    try { await assertPrivateDirectory(this.root); }
    catch (error) { if (!create && missing(error)) return undefined; throw error; }
    await assertCanonicalStoragePath(this.root);
    const rootStat = await lstat(this.root, { bigint: true }); const rootCanonical = await realpath(this.root);
    if (create) {
      try { await mkdir(this.directory, { mode: 0o700 }); await syncDirectory(this.root); }
      catch (error) { if (!(object(error) && error.code === 'EEXIST')) throw error; }
    }
    try { await assertPrivateDirectory(this.directory); }
    catch (error) { if (!create && missing(error)) return undefined; throw error; }
    const stat = await lstat(this.directory, { bigint: true });
    const check = async () => {
      await assertPrivateDirectory(this.root); await assertPrivateDirectory(this.directory);
      const currentRoot = await lstat(this.root, { bigint: true }); const current = await lstat(this.directory, { bigint: true });
      if (currentRoot.dev !== rootStat.dev || currentRoot.ino !== rootStat.ino || current.dev !== stat.dev || current.ino !== stat.ino
        || !samePath(await realpath(this.directory), join(rootCanonical, 'purge-history')))
        throw new ArchiveError('unsafe-path', 'The purge history directory changed.');
      await assertCanonicalStoragePath(this.directory);
    };
    await check(); return check;
  }
  private async read(): Promise<PurgeHistoryEntry[]> {
    let value: unknown;
    try {
      const stat = await lstat(this.path);
      if (!stat.isFile() || stat.isSymbolicLink() || (process.platform !== 'win32'
        && ((stat.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && stat.uid !== process.getuid()))))
        throw new ArchiveError('unsafe-path', 'The purge history file is not private.');
      value = await readBoundedJson(this.path, MAX_BYTES);
    } catch (error) { if (missing(error)) return []; throw error; }
    if (!object(value) || Object.keys(value).some(key => !['schema', 'entries'].includes(key)) || value.schema !== 1
      || !Array.isArray(value.entries) || value.entries.length > MAX_ENTRIES || !value.entries.every(validEntry)
      || new Set(value.entries.map(entry => entry.entryId)).size !== value.entries.length)
      throw new ArchiveError('corrupt-state', 'The purge history is invalid.');
    return value.entries;
  }
  private async write(entries: PurgeHistoryEntry[], unchanged: () => Promise<void>): Promise<void> {
    const encoded = JSON.stringify({ schema: 1, entries }) + '\n';
    if (Buffer.byteLength(encoded) > MAX_BYTES) throw new ArchiveError('metadata-too-large', 'The purge history is too large.');
    const temporary = join(this.directory, `${randomUUID()}.tmp`);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      await unchanged(); handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(encoded); await handle.sync(); await handle.close(); handle = undefined;
      await unchanged();
      // Do not replace a redirect, special file, or unexpectedly exposed history.
      await this.read(); await unchanged();
      await rename(temporary, this.path); await syncDirectory(this.directory);
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      try { await unchanged(); await unlink(temporary); } catch { /* Leave an untrusted path alone. */ }
      throw error;
    }
  }
  private async cleanTemporaryFiles(unchanged: () => Promise<void>): Promise<void> {
    for (const name of await readdir(this.directory)) {
      if (!name.endsWith('.tmp') || !UUID.test(name.slice(0, -4))) continue;
      const path = join(this.directory, name); const before = await lstat(path, { bigint: true });
      if (!before.isFile() || before.isSymbolicLink() || (process.platform !== 'win32'
        && ((before.mode & 0o077n) !== 0n || (typeof process.getuid === 'function' && before.uid !== BigInt(process.getuid())))))
        throw new ArchiveError('unsafe-path', 'A purge history temporary is unsafe.');
      await unchanged(); const current = await lstat(path, { bigint: true });
      if (!current.isFile() || current.isSymbolicLink() || current.dev !== before.dev || current.ino !== before.ino)
        throw new ArchiveError('unsafe-path', 'A purge history temporary changed.');
      await unlink(path); await syncDirectory(this.directory);
    }
  }
  async record(operation: Operation): Promise<void> {
    return this.serialize(async () => {
      try {
        // Only callers that have completed durable purge may supply this phase.
        if (operation.phase !== 'purged') throw new ArchiveError('invalid-request', 'Purge history requires a completed deletion.');
        const entry: PurgeHistoryEntry = { entryId: operation.entryId, sessionId: operation.group.sessionId,
          titleHash: createHash('sha256').update(operation.group.title).digest('hex'),
          sizeBytes: operation.group.members.reduce((sum, member) => sum + member.sizeBytes, 0), memberCount: operation.group.members.length,
          purgedAt: this.now(), ...(operation.requestId ? { requestId: operation.requestId } : {}) };
        if (!validEntry(entry)) throw new ArchiveError('invalid-request', 'Purge history data is invalid.');
        const unchanged = await this.directoryGuard(true); const entries = await this.read();
        await this.cleanTemporaryFiles(unchanged!);
        // Preserve the first observation time and evidence on retries/recovery.
        if (entries.some(previous => previous.entryId === entry.entryId)) {
          const retained = this.retained(entries);
          if (retained.length !== entries.length) await this.write(retained, unchanged!);
          return;
        }
        await this.write(this.retained([...entries, entry]), unchanged!);
      } catch { this.warn(); }
    });
  }
  async recent({ prune = false }: { prune?: boolean } = {}): Promise<PurgeHistoryEntry[]> {
    return this.serialize(async () => {
      try {
        const unchanged = await this.directoryGuard(false); if (!unchanged) return [];
        const entries = await this.read(); const retained = this.retained(entries);
        // Only the active archive service can prune while holding the storage lease.
        if (prune && retained.length !== entries.length) {
          try { await this.write(retained, unchanged); } catch { this.warn(); }
        }
        await unchanged(); return retained;
      } catch { this.warn(); return []; }
    });
  }
}
