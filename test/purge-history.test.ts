import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ArchiveService } from '../src/service.js';
import { PurgeHistory, type PurgeHistoryEntry } from '../src/purge-history.js';
import type { Operation } from '../src/storage.js';
import type { Action } from '../src/contracts.js';
import { fixture, present } from './fixtures.js';

type Fixture = Awaited<ReturnType<typeof fixture>>;
const DAY = 24 * 60 * 60_000;
async function perform(service: ArchiveService, action: Action, ids: string[], requestId = randomUUID()) {
  const preview = await service.preview(action, ids); return service.execute(preview.id, requestId);
}
async function purged(f: Fixture, request = false): Promise<Operation> {
  await f.add('evidence'); await perform(f.service, 'trash', ['evidence']);
  return f.store.purge((await f.store.list())[0]!.id, request ? { requestId: randomUUID(), targetId: 'evidence' } : undefined);
}
function entry(purgedAt: number): PurgeHistoryEntry {
  return { entryId: randomUUID(), sessionId: 'synthetic', titleHash: 'a'.repeat(64), sizeBytes: 99, memberCount: 1, purgedAt };
}
async function seed(f: Fixture, entries: PurgeHistoryEntry[]): Promise<string> {
  const directory = join(f.store.root, 'purge-history'); await mkdir(directory, { mode: 0o700 });
  const path = join(directory, 'history.json'); await writeFile(path, JSON.stringify({ schema: 1, entries }), { mode: 0o600 }); return path;
}

test('successful purge retains a small receipt without titles, paths or log content, and retries keep its first time', async t => {
  const f = await fixture(); t.after(f.close); const operation = await purged(f, true);
  operation.group.title = 'Private title'; operation.group.members[0]!.title = 'Private child title';
  let now = 10 * DAY; const history = new PurgeHistory(f.store.root, { now: () => now });
  await history.record(operation); now += DAY; await history.record(operation);
  const entries = await history.recent(); assert.equal(entries.length, 1);
  assert.deepEqual(entries[0], { entryId: operation.entryId, sessionId: operation.group.sessionId,
    titleHash: createHash('sha256').update('Private title').digest('hex'),
    sizeBytes: operation.group.members.reduce((sum, member) => sum + member.sizeBytes, 0), memberCount: 1,
    purgedAt: 10 * DAY, requestId: operation.requestId });
  const path = join(f.store.root, 'purge-history', 'history.json'); const serialized = await readFile(path, 'utf8');
  for (const privateValue of ['Private', f.root, 'Synthetic test data', 'header', 'members']) assert.equal(serialized.includes(privateValue), false);
  assert.deepEqual(await readdir(join(f.store.root, 'purge-history')), ['history.json']);
  if (process.platform !== 'win32') assert.equal((await lstat(path)).mode & 0o077, 0);
});

test('history is lazy and refuses an incomplete purge without affecting its recovery journal', async t => {
  const f = await fixture(); t.after(f.close); const warnings: string[] = [];
  const history = new PurgeHistory(f.store.root, { warn: message => warnings.push(message) });
  assert.deepEqual(await history.recent(), []); assert.equal(await present(join(f.store.root, 'purge-history')), false);
  const operation = await purged(f); operation.phase = 'purging';
  await history.record(operation); assert.deepEqual(await history.recent(), []);
  assert.equal(await present(join(f.store.root, 'purge-history')), false);
  assert.equal((await f.store.operations()).length, 1); assert.equal(warnings.length, 1);
});

test('retry cleans an interrupted atomic publication and preserves unrelated files', async t => {
  const f = await fixture(); t.after(f.close); const operation = await purged(f); const history = new PurgeHistory(f.store.root);
  await history.record(operation); const before = await history.recent();
  const directory = join(f.store.root, 'purge-history'); const interrupted = join(directory, `${randomUUID()}.tmp`);
  await writeFile(interrupted, '{"schema":1,"entries":', { mode: 0o600 });
  await writeFile(join(directory, 'personal.txt'), 'keep');
  await history.record(operation); assert.equal(await present(interrupted), false);
  assert.equal(await readFile(join(directory, 'personal.txt'), 'utf8'), 'keep'); assert.deepEqual(await history.recent(), before);
});

test('history limits physical retention to 200 entries and prunes records older than 30 days on the next read', async t => {
  const f = await fixture(); t.after(f.close); const operation = await purged(f);
  let now = 50 * DAY; const oldest = entry(now - 2000);
  const records = [oldest, ...Array.from({ length: 199 }, (_, index) => entry(now - index - 1))];
  const path = await seed(f, records); const history = new PurgeHistory(f.store.root, { now: () => now });
  await history.record(operation); const retained = await history.recent(); assert.equal(retained.length, 200);
  assert.equal(retained.some(value => value.entryId === oldest.entryId), false);
  assert.equal(retained[0]!.entryId, operation.entryId);
  assert.equal((JSON.parse(await readFile(path, 'utf8')) as { entries: unknown[] }).entries.length, 200);
  now += 31 * DAY;
  assert.deepEqual(await history.recent(), []);
  assert.equal(JSON.parse(await readFile(path, 'utf8')).entries.length, 200);
  assert.deepEqual(await history.recent({ prune: true }), []);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { schema: 1, entries: [] });
});

test('corrupt or oversized evidence is left untouched and diagnostics expose no underlying content', async t => {
  const f = await fixture(); t.after(f.close); const operation = await purged(f); const warnings: string[] = [];
  const history = new PurgeHistory(f.store.root, { warn: message => warnings.push(message) });
  const path = await seed(f, [{ ...entry(Date.now()), title: 'Private unexpected field' } as PurgeHistoryEntry]);
  const before = await readFile(path); await history.record(operation); assert.deepEqual(await history.recent(), []);
  assert.deepEqual(await readFile(path), before);
  await writeFile(path, 'Private'.repeat(80_000)); const oversized = await readFile(path);
  assert.deepEqual(await history.recent(), []); await history.record(operation); assert.deepEqual(await readFile(path), oversized);
  assert.equal(warnings.length, 4);
  for (const warning of warnings) assert.equal(warning, '[archive-delete] Purge history unavailable: reason=purge-history-storage.');
});

test('history never follows a redirected directory or file', async t => {
  const f = await fixture(); t.after(f.close); const operation = await purged(f);
  const outside = join(f.root, 'outside'); await mkdir(outside); const sentinel = join(outside, 'history.json');
  await writeFile(sentinel, 'Private sentinel');
  const directory = join(f.store.root, 'purge-history'); await symlink(outside, directory, process.platform === 'win32' ? 'junction' : 'dir');
  const history = new PurgeHistory(f.store.root); await history.record(operation); assert.deepEqual(await history.recent(), []);
  assert.equal(await readFile(sentinel, 'utf8'), 'Private sentinel'); assert.deepEqual(await readdir(outside), ['history.json']);

  // Use a second fixture for the file redirect so no test helper deletes through a link.
  const second = await fixture(); t.after(second.close); const another = await purged(second);
  const privateDirectory = join(second.store.root, 'purge-history'); await mkdir(privateDirectory, { mode: 0o700 });
  const target = join(second.root, 'target.json'); await writeFile(target, 'Private file sentinel');
  try { await symlink(target, join(privateDirectory, 'history.json'), 'file'); }
  catch (error) {
    if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') return;
    throw error;
  }
  const fileHistory = new PurgeHistory(second.store.root); await fileHistory.record(another); assert.deepEqual(await fileHistory.recent(), []);
  assert.equal(await readFile(target, 'utf8'), 'Private file sentinel');
  assert.equal((await lstat(join(privateDirectory, 'history.json'))).isSymbolicLink(), true);
});

test('unavailable evidence storage and a throwing logger do not change successful purge or replay', async t => {
  const f = await fixture(); t.after(f.close); await f.add('one');
  await perform(f.service, 'trash', ['one']); const id = (await f.store.list())[0]!.id;
  await mkdir(join(f.store.root, 'purge-history')); await mkdir(join(f.store.root, 'purge-history', 'history.json'));
  let warnings = 0; const service = new ArchiveService(f.adapter, f.store, { warn: () => { warnings++; throw new Error('Private logger failure'); } });
  const preview = await service.preview('purge', [id]); const requestId = randomUUID();
  const result = await service.execute(preview.id, requestId); assert.equal(result.items[0]!.status, 'purged');
  assert.deepEqual(await service.execute(preview.id, requestId), result);
  assert.equal((await f.store.list()).length, 0); assert.equal((await f.store.operations()).length, 0);
  assert.deepEqual((await service.list()).purgeHistory, []); assert.ok(warnings >= 1);
});

test('startup records a completed purge before removing its journal and keeps one stable evidence record', async t => {
  const f = await fixture(); t.after(f.close); const operation = await purged(f);
  const restarted = new ArchiveService(f.adapter, f.store); await restarted.initialize();
  const history = (await restarted.list()).purgeHistory!; assert.equal(history.length, 1); assert.equal(history[0]!.entryId, operation.entryId);
  assert.equal((await f.store.operations()).length, 0);
  const again = new ArchiveService(f.adapter, f.store); await again.initialize(); assert.deepEqual((await again.list()).purgeHistory, history);
});

test('partial purge failure retains its operation and never emits completed-deletion evidence', async t => {
  const f = await fixture(); t.after(f.close); await f.add('partial'); await perform(f.service, 'trash', ['partial']);
  const id = (await f.store.list())[0]!.id;
  const internals = f.store as unknown as { sync(path: string): Promise<void> }; const sync = internals.sync.bind(f.store);
  internals.sync = async path => { if (path === join(f.store.root, 'trash', id, '0')) throw new Error('Synthetic fsync failure'); await sync(path); };
  const result = await perform(f.service, 'purge', [id]); assert.equal(result.items[0]!.status, 'failed');
  assert.equal((await f.store.operations()).some(operation => operation.phase === 'purging'), true);
  assert.deepEqual((await f.service.list()).purgeHistory, []);
  assert.equal(await present(join(f.store.root, 'purge-history')), false);
  internals.sync = sync; const retryId = randomUUID();
  assert.equal((await perform(f.service, 'purge', [id], retryId)).items[0]!.status, 'purged');
  const history = (await f.service.list()).purgeHistory!; assert.equal(history.length, 1); assert.equal(history[0]!.requestId, retryId);
});
