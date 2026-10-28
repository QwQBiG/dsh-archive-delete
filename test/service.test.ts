import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { appendFile, readFile, writeFile, symlink, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, present } from './fixtures.js';
import { ArchiveService } from '../src/service.js';
import type { Action } from '../src/contracts.js';

async function perform(f: Awaited<ReturnType<typeof fixture>>, action: Action, ids: string[]) {
  const preview = await f.service.preview(action, ids); return f.service.execute(preview.id, randomUUID());
}
test('trash/restore/purge survives restart and preserves forks, attachments, spill and project files', async t => {
  const f = await fixture(); t.after(f.close);
  const g = await f.add('parent', ['child']); const fork = await f.add('fork'); f.adapter.archived.delete('fork');
  await mkdir(join(f.root, 'attachments')); await writeFile(join(f.root, 'attachments', 'shared.png'), 'shared');
  await mkdir(join(f.root, 'spill')); await writeFile(join(f.root, 'spill', 'output.txt'), 'spill');
  const original = await readFile(join(g.members[0]!.directory, 'session.v4.jsonl'), 'utf8');
  const moved = await perform(f, 'trash', ['parent']); assert.equal(moved.counts.succeeded, 1);
  assert.equal(await present(g.members[0]!.directory), false); assert.equal(await present(g.members[1]!.directory), false);
  assert.equal(await present(fork.members[0]!.directory), true);
  const restarted = new ArchiveService(f.adapter, f.store); await restarted.initialize();
  const trash = (await restarted.list()).trash; assert.equal(trash.length, 1); assert.equal(trash[0]!.memberCount, 2);
  const p = await restarted.preview('restore', [trash[0]!.id]); await restarted.execute(p.id, randomUUID());
  assert.equal(await readFile(join(g.members[0]!.directory, 'session.v4.jsonl'), 'utf8'), original);
  assert.ok(f.adapter.archived.has('parent')); assert.equal((await f.store.list()).length, 0);
  await perform(f, 'trash', ['parent']); const entry = (await f.store.list())[0]!;
  await perform(f, 'purge', [entry.id]); assert.equal((await f.store.list()).length, 0);
  assert.equal(await readFile(join(f.root, 'attachments', 'shared.png'), 'utf8'), 'shared');
  assert.equal(await readFile(join(f.root, 'spill', 'output.txt'), 'utf8'), 'spill'); assert.equal(f.adapter.locks, 0);
});
test('readonly list and preview do not alter source bytes or metadata', async t => {
  const f = await fixture(); t.after(f.close); const g = await f.add('one');
  const before = await readFile(join(g.members[0]!.directory, 'session.v4.jsonl'));
  await f.service.list(); await f.service.preview('trash', ['one']);
  assert.deepEqual(await readFile(join(g.members[0]!.directory, 'session.v4.jsonl')), before);
  assert.ok(f.adapter.archived.has('one')); assert.equal((await f.store.operations()).length, 0);
});
test('idle loaded sessions queue once, remain visible, and move once on next initialization', async t => {
  const f = await fixture(); t.after(f.close); await f.add('one'); f.adapter.loaded.add('one');
  const answer = await perform(f, 'trash', ['one']); assert.equal(answer.counts.pending, 1);
  assert.equal((await f.service.list()).archived[0]!.pending, true); assert.equal((await f.store.list()).length, 0);
  f.adapter.loaded.clear(); const restarted = new ArchiveService(f.adapter, f.store); await restarted.initialize(); await restarted.initialize();
  assert.equal((await f.store.list()).length, 1); assert.equal((await f.store.operations()).length, 0);
});
test('cancel queued operation persists across restarts', async t => {
  const f = await fixture(); t.after(f.close); const g = await f.add('one'); f.adapter.loaded.add('one');
  await perform(f, 'trash', ['one']); await f.service.cancelPending(['one'], randomUUID());
  f.adapter.loaded.clear(); await new ArchiveService(f.adapter, f.store).initialize();
  assert.equal((await f.store.list()).length, 0); assert.equal(await present(g.members[0]!.directory), true);
});
test('queued data changes and unarchiving invalidate old consent', async t => {
  const f = await fixture(); t.after(f.close); const a = await f.add('a'); const b = await f.add('b');
  f.adapter.loaded.add('a'); f.adapter.loaded.add('b'); await perform(f, 'trash', ['a', 'b']); f.adapter.loaded.clear();
  await appendFile(join(a.members[0]!.directory, 'session.v4.jsonl'), '{"new":true}\n'); f.adapter.archived.delete('b');
  await new ArchiveService(f.adapter, f.store).initialize();
  assert.equal((await f.store.list()).length, 0); assert.equal((await f.store.operations()).length, 0);
  assert.equal(await present(b.members[0]!.directory), true);
});
test('mixed batch distinguishes moved, pending and blocked with no forced stop or external lock takeover', async t => {
  const f = await fixture(); t.after(f.close);
  for (const name of ['cold', 'loaded', 'running', 'external', 'unarchived']) await f.add(name);
  f.adapter.loaded.add('loaded'); f.adapter.active.add('running'); f.adapter.busy.add('external'); f.adapter.archived.delete('unarchived');
  const answer = await perform(f, 'trash', ['cold', 'loaded', 'running', 'external', 'unarchived']);
  assert.deepEqual(answer.counts, { succeeded: 1, pending: 1, skipped: 2, failed: 1 });
  assert.equal(f.adapter.active.has('running'), true); assert.ok(f.adapter.archived.has('external'));
});
test('preview revalidation rejects changed data and repeated request ID returns receipt', async t => {
  const f = await fixture(); t.after(f.close); const g = await f.add('a'); await f.add('b');
  const p = await f.service.preview('trash', ['a']); await appendFile(join(g.members[0]!.directory, 'session.v4.jsonl'), '{}\n');
  const changed = await f.service.execute(p.id, randomUUID()); assert.equal(changed.items[0]!.code, 'source-changed');
  const good = await f.service.preview('trash', ['b']); const req = randomUUID();
  await f.service.execute(good.id, req); const duplicate = await f.service.execute(good.id, req);
  assert.equal(duplicate.items[0]!.status, 'moved'); assert.equal((await f.store.list()).length, 1);
  await assert.rejects(f.service.execute(p.id, req), /already used/);
});
test('metadata failure rolls back all moved members', async t => {
  const f = await fixture(); t.after(f.close); const g = await f.add('parent', ['child']); f.adapter.failRemove = true;
  const answer = await perform(f, 'trash', ['parent']); assert.equal(answer.counts.failed, 1);
  for (const member of g.members) assert.equal(await present(member.directory), true);
  assert.equal((await f.store.list()).length, 0); assert.equal((await f.store.operations()).length, 0);
  assert.ok(f.adapter.archived.has('parent')); assert.equal(f.adapter.locks, 0);
});
test('startup rolls back a crash after moving files but before registry commit', async t => {
  const f = await fixture(); t.after(f.close); const g = await f.add('parent', ['child']);
  await f.store.prepareTrash(await f.adapter.inspect('parent'));
  assert.equal(await present(g.members[0]!.directory), false);
  await new ArchiveService(f.adapter, f.store).initialize();
  assert.equal(await present(g.members[0]!.directory), true); assert.equal(await present(g.members[1]!.directory), true);
  assert.equal((await f.store.operations()).length, 0);
});
test('startup rolls back an interrupted restore and allows explicit retry', async t => {
  const f = await fixture(); t.after(f.close); const g = await f.add('parent', ['child']);
  await perform(f, 'trash', ['parent']); const key = (await f.store.list())[0]!.id; await f.store.prepareRestore(key);
  await new ArchiveService(f.adapter, f.store).initialize();
  assert.equal(await present(g.members[0]!.directory), false); assert.equal((await f.store.list()).length, 1);
  assert.equal((await perform(f, 'restore', [key])).counts.succeeded, 1);
});
test('unknown files, links and path escape refuse mutations', async t => {
  const f = await fixture(); t.after(f.close); const g = await f.add('unknown'); const s = await f.add('link');
  await writeFile(join(g.members[0]!.directory, 'personal.txt'), 'keep'); await symlink(g.members[0]!.directory, join(s.members[0]!.directory, 'link'));
  const answer = await perform(f, 'trash', ['unknown', 'link']); assert.equal(answer.counts.failed, 2);
  assert.equal(await readFile(join(g.members[0]!.directory, 'personal.txt'), 'utf8'), 'keep');
  const escaped = await f.adapter.inspect('unknown'); escaped.members[0]!.directory = f.root;
  await assert.rejects(f.store.prepareTrash(escaped), /expected layout/);
});
test('restore collision keeps trash and existing destination bytes intact', async t => {
  const f = await fixture(); t.after(f.close); const g = await f.add('one'); await perform(f, 'trash', ['one']);
  const key = (await f.store.list())[0]!.id;
  await mkdir(g.members[0]!.directory); await writeFile(join(g.members[0]!.directory, 'session.v4.jsonl'), 'replacement');
  const p = await f.service.preview('restore', [key]); assert.equal(p.items[0]!.disposition, 'blocked');
  assert.equal(await readFile(join(g.members[0]!.directory, 'session.v4.jsonl'), 'utf8'), 'replacement');
  assert.equal((await f.store.list()).length, 1);
});
test('unsupported host refuses mutation, invalid inputs do not write', async t => {
  const f = await fixture(); t.after(f.close); await f.add('one');
  await assert.rejects(f.service.preview('trash', []), /Select between/);
  await assert.rejects(f.service.preview('trash', ['one', 'one']), /Duplicate/);
  f.adapter.supported = false; await assert.rejects(f.service.preview('trash', ['one']), /unsupported/);
  assert.equal((await f.store.list()).length, 0);
});
test('permanent cleanup removes entry metadata and no user text enters receipts', async t => {
  const f = await fixture(); t.after(f.close); await f.add('one'); await perform(f, 'trash', ['one']);
  const key = (await f.store.list())[0]!.id; await perform(f, 'purge', [key]);
  assert.deepEqual(await readdir(join(f.store.root, 'trash')), []);
  const receipts = await readdir(join(f.store.root, 'receipts'));
  for (const file of receipts) assert.equal((await readFile(join(f.store.root, 'receipts', file), 'utf8')).includes('Test one'), false);
});
