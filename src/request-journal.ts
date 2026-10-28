import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ArchiveError, type BatchResult, type ItemResult, type Preview, type SessionGroup } from './contracts.js';

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
  return object(value) && typeof value.id === 'string' && typeof value.title === 'string'
    && typeof value.status === 'string' && STATUSES.has(value.status)
    && (value.code === undefined || typeof value.code === 'string')
    && (value.message === undefined || typeof value.message === 'string');
}
function validate(value: unknown, id: string): asserts value is RequestRecord {
  if (!object(value) || value.schema !== 1 || value.requestId !== id || typeof value.fingerprint !== 'string'
    || typeof value.complete !== 'boolean' || !object(value.result) || value.result.operationId !== id
    || !['trash', 'restore', 'purge', 'cancel'].includes(String(value.result.action))
    || !Array.isArray(value.result.items) || !value.result.items.every(validItem)
    || new Set(value.result.items.map(item => item.id)).size !== value.result.items.length)
    throw new ArchiveError('corrupt-state', 'A request receipt is invalid.');
  if (value.complete) {
    if (value.preview !== undefined || value.groups !== undefined || value.fingerprints !== undefined
      || value.result.items.some(item => item.title !== ''))
      throw new ArchiveError('corrupt-state', 'A completed request receipt retains recovery content.');
  } else if (!object(value.preview) || typeof value.preview.id !== 'string'
    || !['trash', 'restore', 'purge'].includes(String(value.preview.action))
    || (value.preview.action !== value.result.action && !(value.result.action === 'cancel' && value.preview.action === 'trash'))
    || !Array.isArray(value.preview.items)
    || !value.preview.items.every(item => object(item) && typeof item.id === 'string' && typeof item.title === 'string')
    || new Set(value.preview.items.map(item => item.id)).size !== value.preview.items.length
    || !object(value.groups) || !object(value.fingerprints)) {
    throw new ArchiveError('corrupt-state', 'An incomplete request receipt is invalid.');
  }
}

/** Durable request progress. The host holds the plugin-store lease around its lifetime. */
export class RequestJournal {
  private readonly directory: string;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(root: string) { this.directory = join(resolve(root), 'receipts'); }
  private path(id: string): string { return join(this.directory, `${requestId(id)}.json`); }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work, work); this.tail = next.catch(() => {}); return next;
  }
  private async directorySafe(): Promise<void> {
    const stat = await lstat(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o022) !== 0
      || (typeof process.getuid === 'function' && stat.uid !== process.getuid()))
      throw new ArchiveError('unsafe-path', 'Request storage must be a private directory owned by this user.');
  }
  private async read(id: string, fingerprint?: string): Promise<RequestRecord | undefined> {
    const path = this.path(id);
    let handle: Awaited<ReturnType<typeof open>>;
    try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (error) { if (missing(error)) return undefined; throw error; }
    let value: unknown;
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new ArchiveError('corrupt-state', 'A request receipt is invalid.');
      try { value = JSON.parse(await handle.readFile('utf8')) as unknown; }
      catch { throw new ArchiveError('corrupt-state', 'A request receipt could not be read.'); }
    } finally { await handle.close(); }
    validate(value, id);
    if (fingerprint !== undefined && value.fingerprint !== fingerprint)
      throw new ArchiveError('request-conflict', 'This request identifier was already used.');
    value.result.counts = counts(value.result.items);
    return value;
  }
  private async write(record: RequestRecord): Promise<void> {
    await this.directorySafe();
    const path = this.path(record.requestId);
    const temporary = `${path}.${randomUUID()}.tmp`;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(record)}\n`); await handle.sync();
      await handle.close(); handle = undefined;
      await rename(temporary, path);
      const directory = await open(this.directory, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
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
      if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0
        || (typeof process.getuid === 'function' && stat.uid !== process.getuid()))
        throw new ArchiveError('unsafe-path', 'A temporary request receipt needs attention.');
      await unlink(path); changed = true;
    }
    if (changed) {
      const directory = await open(this.directory, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
  }
  async begin(id: string, fingerprint: string, context: RequestContext, action?: 'cancel'): Promise<RequestRecord> {
    return this.serialize(async () => {
      await this.directorySafe();
      const existing = await this.read(id, fingerprint); if (existing) return existing;
      const record: RequestRecord = { schema: 1, requestId: requestId(id), fingerprint, complete: false,
        ...structuredClone(context), result: { operationId: id, action: action ?? context.preview.action, items: [], counts: counts([]) } };
      validate(record, id); await this.write(record); return structuredClone(record);
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
      const merged = structuredClone(item); if (record.complete) merged.title = '';
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
    // Atomic-write remnants never supersede a canonical record or authorize a transition.
    await this.discardTemps();
    const result: RequestRecord[] = [];
    for (const name of (await readdir(this.directory)).sort()) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -5); requestId(id);
      const record = await this.read(id); if (record) result.push(record);
    }
    return result;
  }
  async incomplete(): Promise<RequestRecord[]> {
    return this.serialize(async () => (await this.records()).filter(record => !record.complete));
  }
  async recent(): Promise<BatchResult[]> {
    return this.serialize(async () => {
      const records = (await this.records()).filter(record => record.complete);
      const dated = await Promise.all(records.map(async record => ({ record, mtime: (await lstat(this.path(record.requestId))).mtimeMs })));
      return dated.sort((a, b) => b.mtime - a.mtime).slice(0, 10).map(value => value.record.result);
    });
  }
}
