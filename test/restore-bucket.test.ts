import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rmdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ArchiveService } from '../src/service.js';
import { fixture, present } from './fixtures.js';

test('restore recreates only the missing internal bucket and preserves all group bytes', async t => {
  const f = await fixture(); t.after(f.close); const group = await f.add('parent', ['child']);
  const original = await Promise.all(group.members.map(member => readFile(join(member.directory, 'session.v4.jsonl'))));
  const preview = await f.service.preview('trash', ['parent']); await f.service.execute(preview.id, randomUUID());
  await rmdir(dirname(group.members[0]!.directory));
  const entry = (await f.store.list())[0]!; const restore = await f.service.preview('restore', [entry.id]);
  assert.equal(restore.items[0]!.disposition, 'ready');
  const result = await f.service.execute(restore.id, randomUUID());
  assert.equal(result.items[0]!.status, 'restored');
  for (const [index, member] of group.members.entries()) assert.deepEqual(await readFile(join(member.directory, 'session.v4.jsonl')), original[index]);
  assert.equal(f.adapter.archived.has('parent'), true); assert.deepEqual(await f.store.list(), []);
  assert.equal(f.adapter.locks, 0);
});

test('startup rollback recreates a missing bucket before returning staged group members', async t => {
  const f = await fixture(); t.after(f.close); const group = await f.add('parent', ['child']);
  const original = await Promise.all(group.members.map(member => readFile(join(member.directory, 'session.v4.jsonl'))));
  await f.store.prepareTrash(await f.adapter.inspect('parent'));
  await rmdir(dirname(group.members[0]!.directory));
  const restarted = new ArchiveService(f.adapter, f.store); await restarted.initialize();
  for (const [index, member] of group.members.entries()) assert.deepEqual(await readFile(join(member.directory, 'session.v4.jsonl')), original[index]);
  assert.equal((await f.store.operations()).length, 0); assert.deepEqual(await f.store.list(), []);
  assert.equal(f.adapter.archived.has('parent'), true); assert.equal(f.adapter.locks, 0);
});

test('metadata failure rolls a staged move back even if its empty source bucket was removed', async t => {
  const f = await fixture(); t.after(f.close); const group = await f.add('parent', ['child']);
  f.adapter.removeRegistry = async () => { await rmdir(dirname(group.members[0]!.directory)); throw Error('Synthetic metadata failure'); };
  const preview = await f.service.preview('trash', ['parent']); const result = await f.service.execute(preview.id, randomUUID());
  assert.equal(result.items[0]!.status, 'failed');
  for (const member of group.members) assert.equal(await present(join(member.directory, 'session.v4.jsonl')), true);
  assert.equal((await f.store.operations()).length, 0); assert.deepEqual(await f.store.list(), []); assert.equal(f.adapter.locks, 0);
});

for (const replacement of ['link', 'file'] as const) test(`restore rejects a bucket replaced with a ${replacement}`, async t => {
  const f = await fixture(); t.after(f.close); const group = await f.add('one');
  const preview = await f.service.preview('trash', ['one']); await f.service.execute(preview.id, randomUUID());
  const bucket = dirname(group.members[0]!.directory); await rmdir(bucket);
  const outside = join(f.root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'keep.txt'), 'outside bytes');
  if (replacement === 'file') await writeFile(bucket, 'ordinary file');
  else {
    try { await symlink(outside, bucket, process.platform === 'win32' ? 'junction' : 'dir'); }
    catch (error) { if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') { t.skip('Directory links require permission.'); return; } throw error; }
  }
  const entryNames = await readdir(join(f.store.root, 'trash'));
  const restore = await f.service.preview('restore', [entryNames[0]!]);
  assert.equal(restore.items[0]!.disposition, 'blocked');
  assert.equal((await f.service.execute(restore.id, randomUUID())).items[0]!.status, 'skipped');
  assert.equal(await readFile(join(outside, 'keep.txt'), 'utf8'), 'outside bytes'); assert.equal(await present(join(outside, 'one')), false);
});

test('restore uses the existing internal bucket without replacing an unrelated session', async t => {
  const f = await fixture(); t.after(f.close); await f.add('one'); const neighbor = await f.add('neighbor');
  const before = await readFile(join(neighbor.members[0]!.directory, 'session.v4.jsonl'));
  const move = await f.service.preview('trash', ['one']); await f.service.execute(move.id, randomUUID());
  const restore = await f.service.preview('restore', [(await f.store.list())[0]!.id]);
  assert.equal((await f.service.execute(restore.id, randomUUID())).items[0]!.status, 'restored');
  assert.deepEqual(await readFile(join(neighbor.members[0]!.directory, 'session.v4.jsonl')), before);
});
