import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rmdir, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fixture, present } from './fixtures.js';
import { directoryPublicationPaths, TrashStore, type Operation } from '../src/storage.js';
import { ArchiveService } from '../src/service.js';

type StoreInternals = { sync(path: string): Promise<void>; writeOperation(operation: Operation): Promise<void> };
const internals = (store: TrashStore) => store as unknown as StoreInternals;

test('directory publication is bounded for POSIX roots and recursive creation chains', () => {
  assert.deepEqual(directoryPublicationPaths('/data/new/plugin', '/data/new', 'darwin'), ['/data/new/plugin', '/data/new', '/data']);
  assert.deepEqual(directoryPublicationPaths('/data/plugin', undefined, 'darwin'), ['/data/plugin', '/data']);
  assert.deepEqual(directoryPublicationPaths('/', '/', 'darwin'), ['/']);
  for (const unrelated of ['/other', '/data/sibling', '/data/new/plugin/child'])
    assert.throws(() => directoryPublicationPaths('/data/new/plugin', unrelated, 'darwin'), { code: 'unsafe-path' });
});

test('Windows directory publication admits mkdir namespace spelling without walking forever at a drive root', () => {
  const root = String.raw`C:\Users\Runner\new\plugin`;
  const expected = [root, String.raw`C:\Users\Runner\new`, String.raw`C:\Users\Runner`];
  assert.deepEqual(directoryPublicationPaths(root, String.raw`\\?\C:\Users\Runner\new`, 'win32'), expected);
  assert.deepEqual(directoryPublicationPaths(root, String.raw`c:\users\runner\NEW`, 'win32'), expected);
  assert.deepEqual(directoryPublicationPaths('C:\\', '\\\\?\\C:\\', 'win32'), ['C:\\']);
  for (const unrelated of [String.raw`D:\new`, String.raw`C:\other`, String.raw`C:\Users\Runner\new\plugin\child`, String.raw`\\?\UNC\server\share`])
    assert.throws(() => directoryPublicationPaths(root, unrelated, 'win32'), { code: 'unsafe-path' });
});

test('initialization publishes a newly created ancestor chain once before returning', async t => {
  const f = await fixture(); t.after(f.close);
  const root = join(f.root, 'new-parent', 'new-child', 'plugin');
  const store = new TrashStore({ root, sessionsRoot: f.sessions });
  const methods = internals(store); const sync = methods.sync.bind(methods); const observed: string[] = [];
  methods.sync = async path => { observed.push(path); await sync(path); };
  await store.initialize();
  assert.deepEqual(observed, [root, join(f.root, 'new-parent', 'new-child'), join(f.root, 'new-parent'), f.root]);
  for (const area of ['trash', 'staging', 'operations', 'receipts']) assert.equal(await present(join(root, area)), true);
});
async function trashed(t: TestContext, children: string[] = []) {
  const f = await fixture(); t.after(f.close); const group = await f.add('parent', children);
  const operation = await f.store.prepareTrash(group); await f.store.markDetached(operation);
  await f.store.commitTrash(operation); await f.store.finish(operation);
  return { ...f, group, entryId: operation.entryId, entry: join(f.store.root, 'trash', operation.entryId) };
}

test('a staging parent flush failure never starts removing source sessions', async t => {
  const f = await fixture(); t.after(f.close); const group = await f.add('parent', ['child']);
  const before = await Promise.all(group.members.map(member => readFile(join(member.directory, 'session.v4.jsonl'))));
  const store = internals(f.store); const sync = store.sync.bind(store);
  store.sync = async path => {
    if (path === join(f.store.root, 'staging')) throw new Error('Synthetic staging parent flush failure');
    await sync(path);
  };
  await assert.rejects(f.store.prepareTrash(group), /staging parent flush failure/);
  for (const [index, member] of group.members.entries()) assert.deepEqual(await readFile(join(member.directory, 'session.v4.jsonl')), before[index]);
  assert.equal((await f.store.operations())[0]!.phase, 'moving');
  store.sync = sync;
  await new ArchiveService(f.adapter, f.store).initialize();
  assert.deepEqual(await readdir(join(f.store.root, 'staging')), []);
  assert.deepEqual(await f.store.operations(), []);
});

test('purge durably removes each member before discarding its recovery manifest', async t => {
  const f = await trashed(t, ['child']);
  const store = internals(f.store); const sync = store.sync.bind(store);
  const events: { path: string; manifest: boolean; members: boolean[] }[] = [];
  store.sync = async path => {
    events.push({ path, manifest: await present(join(f.entry, 'manifest.json')),
      members: await Promise.all([0, 1].map(index => present(join(f.entry, String(index))))) });
    await sync(path);
  };
  const operation = await f.store.purge(f.entryId);
  assert.equal(operation.phase, 'purged');
  assert.deepEqual(events.map(event => event.path), [join(f.entry, '0'), f.entry, join(f.entry, '1'), f.entry, f.entry, f.entry, join(f.store.root, 'trash')]);
  assert.deepEqual(events.map(event => event.manifest), [true, true, true, true, true, false, false]);
  assert.deepEqual(events[0]!.members, [true, true]); assert.deepEqual(events[1]!.members, [false, true]);
  assert.deepEqual(events[2]!.members, [false, true]); assert.deepEqual(events[3]!.members, [false, false]);
  assert.equal(await present(f.entry), false);
});

for (const phase of ['member-files', 'member-removal', 'manifest-removal', 'entry-removal'] as const) {
  test(`purge ${phase} flush failure retains its journal and recovers without inventing success`, async t => {
    const f = await trashed(t); const store = internals(f.store); const sync = store.sync.bind(store);
    let interrupted = false;
    store.sync = async path => {
      const fail = phase === 'member-files' ? path === join(f.entry, '0')
        : phase === 'member-removal' ? path === f.entry && await present(join(f.entry, 'manifest.json'))
        : phase === 'manifest-removal' ? path === f.entry && !await present(join(f.entry, 'manifest.json'))
        : path === join(f.store.root, 'trash') && !await present(f.entry);
      if (!interrupted && fail) { interrupted = true; throw new Error('Synthetic deletion flush failure'); }
      await sync(path);
    };
    await assert.rejects(f.store.purge(f.entryId), /deletion flush failure/);
    assert.equal(interrupted, true);
    const journal = (await f.store.operations())[0]!; assert.equal(journal.phase, 'purging');
    if (phase === 'member-files' || phase === 'member-removal') assert.equal(await present(join(f.entry, 'manifest.json')), true);
    store.sync = sync;
    const restarted = new ArchiveService(f.adapter, f.store); await restarted.initialize();
    if (phase === 'member-files') {
      assert.equal((await f.store.operations())[0]!.phase, 'purging');
      assert.equal((await restarted.list()).trash.length, 1);
      const preview = await restarted.preview('purge', [f.entryId]);
      const result = await restarted.execute(preview.id, randomUUID()); assert.equal(result.counts.succeeded, 1);
    }
    assert.equal(await present(f.entry), false); assert.deepEqual(await f.store.operations(), []); assert.equal(f.adapter.locks, 0);
  });
}

test('one missing manifest leaves its bytes untouched and does not hide healthy trash', async t => {
  const f = await trashed(t); const healthy = await f.add('healthy');
  const operation = await f.store.prepareTrash(healthy); await f.store.markDetached(operation); await f.store.commitTrash(operation); await f.store.finish(operation);
  const bytes = await readFile(join(f.entry, '0', 'session.v4.jsonl')); await unlink(join(f.entry, 'manifest.json'));
  await assert.rejects(f.store.manifest(f.entryId), { code: 'corrupt-state' });
  assert.deepEqual((await f.store.list()).map(entry => entry.id), [operation.entryId]);
  assert.deepEqual(f.store.listIssues().map(issue => [issue.scope, issue.id, issue.code]), [['trash', f.entryId, 'corrupt-state']]);
  assert.deepEqual(await readFile(join(f.entry, '0', 'session.v4.jsonl')), bytes);
  assert.deepEqual(await f.store.operations(), []);
});

test('unknown trash data is reported separately while an unsafe trash root still rejects', async t => {
  const f = await trashed(t); const unknown = join(f.store.root, 'trash', 'unowned'); await mkdir(unknown);
  await writeFile(join(unknown, 'keep'), 'retained');
  assert.equal((await f.store.list()).length, 1); assert.equal(f.store.listIssues()[0]!.id, 'unowned');
  assert.equal(await readFile(join(unknown, 'keep'), 'utf8'), 'retained');
  const original = join(f.store.root, 'trash-original'); await rename(join(f.store.root, 'trash'), original);
  const outside = join(f.root, 'outside'); await mkdir(outside);
  await symlink(outside, join(f.store.root, 'trash'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.store.list(), { code: 'unsafe-path' }); assert.deepEqual(await readdir(outside), []);
});

test('listing reads recovery journals once for the whole trash inventory', async t => {
  const f = await trashed(t);
  for (const key of ['second', 'third']) {
    const group = await f.add(key); const operation = await f.store.prepareTrash(group);
    await f.store.markDetached(operation); await f.store.commitTrash(operation); await f.store.finish(operation);
  }
  const operations = f.store.operations.bind(f.store); let reads = 0;
  f.store.operations = async () => { reads++; return operations(); };
  assert.equal((await f.store.list()).length, 3); assert.equal(reads, 1);
});

test('a missing empty source bucket does not strand cancellation or completed trash', async t => {
  const f = await trashed(t); await rmdir(join(f.sessions, 'project'));
  await f.store.queue(f.group, 'Synthetic obsolete request');
  assert.equal((await f.store.operations()).length, 1);
  assert.equal(await f.store.cancelPending(f.group.sessionId), true); assert.deepEqual(await f.store.operations(), []);
  assert.equal((await f.store.list()).length, 1);
  const operation = await f.store.purge(f.entryId); await f.store.finish(operation);
  assert.deepEqual(await f.store.list(), []); assert.equal(await present(join(f.sessions, 'project')), false);
});

test('an existing redirected source bucket remains unsafe during recovery', async t => {
  const f = await trashed(t); await f.store.queue(f.group, 'Synthetic pending request');
  await rmdir(join(f.sessions, 'project')); const outside = join(f.root, 'outside'); await mkdir(outside);
  await symlink(outside, join(f.sessions, 'project'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.store.operations(), { code: 'unsafe-path' }); assert.deepEqual(await readdir(outside), []);
  assert.equal(await present(join(f.entry, 'manifest.json')), true);
});

for (const target of ['entry', 'member'] as const) {
  test(`purge rechecks ${target} identity after journaling and refuses a substituted link`, async t => {
    const f = await trashed(t); const outside = join(f.root, 'outside'); await mkdir(outside);
    const outsideMember = target === 'entry' ? join(outside, '0') : outside;
    if (target === 'entry') await mkdir(outsideMember);
    const outsideFile = join(outsideMember, 'session.v4.jsonl'); await writeFile(outsideFile, 'external synthetic bytes');
    const store = internals(f.store); const write = store.writeOperation.bind(store); let replaced = false;
    store.writeOperation = async operation => {
      await write(operation);
      if (!replaced && operation.phase === 'purging') {
        replaced = true; const path = target === 'entry' ? f.entry : join(f.entry, '0');
        await rename(path, `${path}-retained`); await symlink(outside, path, process.platform === 'win32' ? 'junction' : 'dir');
      }
    };
    await assert.rejects(f.store.purge(f.entryId), { code: 'unsafe-path' });
    assert.equal(replaced, true); assert.equal(await readFile(outsideFile, 'utf8'), 'external synthetic bytes');
    assert.equal((await f.store.operations())[0]!.phase, 'purging');
  });
}

test('a new unknown container file during purge retains its manifest and remains visible as an issue', async t => {
  const f = await trashed(t); const store = internals(f.store); const write = store.writeOperation.bind(store);
  store.writeOperation = async operation => {
    await write(operation); if (operation.phase === 'purging') await writeFile(join(f.entry, 'unowned'), 'keep');
  };
  await assert.rejects(f.store.purge(f.entryId), { code: 'unknown-file' });
  assert.equal(await present(join(f.entry, 'manifest.json')), true); assert.equal(await readFile(join(f.entry, 'unowned'), 'utf8'), 'keep');
  assert.deepEqual(await f.store.list(), []); assert.equal(f.store.listIssues()[0]!.code, 'unknown-file');
});
