import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, present } from './fixtures.js';
import { ArchiveService } from '../src/service.js';
import type { Action, ItemResult, SessionGroup } from '../src/contracts.js';
import { RequestJournal } from '../src/request-journal.js';

type Fixture = Awaited<ReturnType<typeof fixture>>;
for (const action of ['restore', 'purge'] as const) {
  test(`${action}: changed trash bytes while obtaining the lease require fresh consent`, async t => {
    const f = await fixture(); t.after(f.close); const group = await f.add(`lock-race-${action}`);
    const move = await f.service.preview('trash', [group.sessionId]); await f.service.execute(move.id, randomUUID());
    const entry = (await f.store.list())[0]!; const file = join(f.store.root, 'trash', entry.id, '0', 'session.v4.jsonl');
    const preview = await f.service.preview(action, [entry.id]);
    const acquire = f.adapter.acquireLocated.bind(f.adapter); let changed = false;
    f.adapter.acquireLocated = async (members, locations) => {
      if (!changed) { changed = true; await appendFile(file, 'writer finished before lock admission\n'); }
      return acquire(members, locations);
    };
    const outcome = await f.service.execute(preview.id, randomUUID());
    assert.equal(outcome.items[0]!.status, 'failed'); assert.equal(outcome.items[0]!.code, 'source-changed');
    assert.match(await readFile(file, 'utf8'), /writer finished before lock admission/);
    assert.equal(await present(group.members[0]!.directory), false);
    assert.equal((await f.store.list())[0]!.id, entry.id); assert.equal(f.adapter.locks, 0);
    const fresh = await f.service.preview(action, [entry.id]);
    assert.equal((await f.service.execute(fresh.id, randomUUID())).items[0]!.status, action === 'restore' ? 'restored' : 'purged');
  });
}
async function perform(f: Fixture, action: Action, ids: string[]) {
  const preview = await f.service.preview(action, ids); return f.service.execute(preview.id, randomUUID());
}
async function seedOperation(f: Fixture, phase: string, group: SessionGroup, entryId: string = randomUUID()) {
  const operation = { schema: 1, id: randomUUID(), entryId, phase, group, createdAt: Date.now(), moved: [] };
  await writeFile(join(f.store.root, 'operations', `${operation.id}.json`), JSON.stringify(operation), { mode: 0o600 });
  return operation;
}

for (const action of ['trash', 'restore', 'purge'] as const) {
  test(`${action}: a lost per-target receipt after commit retries the same durable outcome`, async t => {
    const f = await fixture(); t.after(f.close); await f.add('one');
    let target = 'one';
    if (action !== 'trash') { await perform(f, 'trash', ['one']); target = (await f.store.list())[0]!.id; }
    const preview = await f.service.preview(action, [target]); const requestId = randomUUID();
    const journal = (f.service as unknown as { requests: RequestJournal }).requests;
    const record = journal.record.bind(journal); let injected = false;
    journal.record = async (id: string, item: ItemResult) => {
      if (!injected && id === requestId) { injected = true; throw new Error('Synthetic failure after file transition and before result persistence'); }
      return record(id, item);
    };
    await assert.rejects(f.service.execute(preview.id, requestId), /Synthetic failure/);
    assert.equal((await f.store.operations()).some(operation => operation.requestId === requestId), true);
    const restarted = new ArchiveService(f.adapter, f.store); await restarted.initialize();
    const answer = await restarted.execute(preview.id, requestId);
    assert.equal(answer.items[0]!.status, action === 'trash' ? 'moved' : action === 'restore' ? 'restored' : 'purged');
    assert.deepEqual(answer.counts, { succeeded: 1, pending: 0, skipped: 0, failed: 0 });
    assert.deepEqual(await restarted.execute(preview.id, requestId), answer);
    assert.equal((await f.store.operations()).some(operation => operation.requestId === requestId), false);
    assert.equal(f.adapter.locks, 0);
  });
}

test('restart completes restore cleanup after its manifest was unlinked', async t => {
  const f = await fixture(); t.after(f.close); const group = await f.add('one');
  const original = await readFile(join(group.members[0]!.directory, 'session.v4.jsonl'));
  await perform(f, 'trash', ['one']); const key = (await f.store.list())[0]!.id;
  const operation = await f.store.prepareRestore(key); await f.adapter.restoreRegistry(operation.group); await f.store.markRestored(operation);
  await unlink(join(f.store.root, 'trash', key, 'manifest.json'));
  const restarted = new ArchiveService(f.adapter, f.store); await restarted.initialize();
  assert.equal((await f.store.operations()).length, 0); assert.equal((await restarted.list()).trash.length, 0);
  assert.equal(await present(join(f.store.root, 'trash', key)), false);
  assert.deepEqual(await readFile(join(group.members[0]!.directory, 'session.v4.jsonl')), original);
  assert.equal(f.adapter.archived.has('one'), true); assert.equal(f.adapter.locks, 0);
});

test('restart completes purge cleanup after its logs and manifest were removed', async t => {
  const f = await fixture(); t.after(f.close); await f.add('one'); await perform(f, 'trash', ['one']);
  const key = (await f.store.list())[0]!.id; const manifest = await f.store.manifest(key);
  await seedOperation(f, 'purging', manifest.group, key);
  await unlink(join(f.store.root, 'trash', key, '0', 'session.v4.jsonl'));
  await rmdir(join(f.store.root, 'trash', key, '0'));
  await unlink(join(f.store.root, 'trash', key, 'manifest.json'));
  const restarted = new ArchiveService(f.adapter, f.store); await restarted.initialize();
  assert.equal((await f.store.operations()).length, 0); assert.equal((await restarted.list()).trash.length, 0);
  assert.equal(await present(join(f.store.root, 'trash', key)), false); assert.equal(f.adapter.locks, 0);
});

test('restart cleans an empty staging directory created before its manifest', async t => {
  const f = await fixture(); t.after(f.close); const group = await f.add('one');
  const operation = await seedOperation(f, 'moving', await f.adapter.inspect('one'));
  const staging = join(f.store.root, 'staging', operation.entryId); await mkdir(staging, { mode: 0o700 });
  const restarted = new ArchiveService(f.adapter, f.store); await restarted.initialize();
  assert.equal((await f.store.operations()).length, 0); assert.equal(await present(staging), false);
  assert.equal(await present(group.members[0]!.directory), true); assert.equal(f.adapter.archived.has('one'), true);
  assert.equal((await restarted.list()).trash.length, 0); assert.equal(f.adapter.locks, 0);
});

test('a partially purged multiple-generation session cannot be reported as restored', async t => {
  const f = await fixture(); t.after(f.close); const group = await f.add('one');
  await writeFile(join(group.members[0]!.directory, 'session.v3.jsonl'), 'Synthetic older log generation\n');
  await perform(f, 'trash', ['one']); const key = (await f.store.list())[0]!.id; const manifest = await f.store.manifest(key);
  await seedOperation(f, 'purging', manifest.group, key);
  await unlink(join(f.store.root, 'trash', key, '0', 'session.v4.jsonl'));
  const preview = await f.service.preview('restore', [key]);
  assert.equal(preview.items[0]!.disposition, 'blocked'); assert.equal(preview.items[0]!.code, 'purge-interrupted');
  const answer = await f.service.execute(preview.id, randomUUID()); assert.equal(answer.items[0]!.status, 'skipped');
  assert.equal(await present(group.members[0]!.directory), false);
  assert.equal(await readFile(join(f.store.root, 'trash', key, '0', 'session.v3.jsonl'), 'utf8'), 'Synthetic older log generation\n');
});

test('changed trash log bytes reject a previously confirmed purge', async t => {
  const f = await fixture(); t.after(f.close); await f.add('one'); await perform(f, 'trash', ['one']);
  const key = (await f.store.list())[0]!.id; const path = join(f.store.root, 'trash', key, '0', 'session.v4.jsonl');
  const preview = await f.service.preview('purge', [key]); await appendFile(path, '{"newSyntheticData":true}\n');
  const changed = await readFile(path, 'utf8'); const answer = await f.service.execute(preview.id, randomUUID());
  assert.equal(answer.items[0]!.status, 'failed'); assert.equal(answer.items[0]!.code, 'source-changed');
  assert.equal(await readFile(path, 'utf8'), changed); assert.equal((await f.store.list()).length, 1);
});

test('an unrelated empty trash container is not proof that a source was committed', async t => {
  const f = await fixture(); t.after(f.close); const group = await f.add('one');
  const operation = await seedOperation(f, 'moving', await f.adapter.inspect('one'));
  await mkdir(join(f.store.root, 'trash', operation.entryId), { mode: 0o700 });
  const restarted = new ArchiveService(f.adapter, f.store); await restarted.initialize();
  assert.equal(f.adapter.archived.has('one'), true);
  assert.equal(await present(group.members[0]!.directory), true);
  assert.equal((await f.store.operations()).some(saved => saved.id === operation.id), true);
  assert.equal(f.adapter.locks, 0);
});

test('restore and interrupted recovery respect a writer that appeared after the crash', async t => {
  const f = await fixture(); t.after(f.close); const group = await f.add('one');
  await perform(f, 'trash', ['one']); const key = (await f.store.list())[0]!.id;
  f.adapter.busy.add('one'); const blocked = await perform(f, 'restore', [key]); assert.equal(blocked.items[0]!.status, 'failed');
  assert.equal(await present(group.members[0]!.directory), false); f.adapter.busy.clear();
  await f.store.prepareRestore(key); f.adapter.busy.add('one');
  const restarted = new ArchiveService(f.adapter, f.store); await restarted.initialize();
  assert.equal(await present(group.members[0]!.directory), true);
  assert.equal((await f.store.operations()).some(operation => operation.phase === 'restoring'), true);
  assert.equal(f.adapter.locks, 0);
});

test('cancelling a pending move updates its original durable receipt', async t => {
  const f = await fixture(); t.after(f.close); const group = await f.add('one'); f.adapter.loaded.add('one');
  const preview = await f.service.preview('trash', ['one']); const requestId = randomUUID();
  assert.equal((await f.service.execute(preview.id, requestId)).items[0]!.status, 'pending');
  assert.equal((await f.service.cancelPending(['one'], randomUUID())).items[0]!.status, 'cancelled');
  const saved = await new RequestJournal(f.store.root).load(requestId);
  assert.equal(saved!.complete, true); assert.equal(saved!.result.items[0]!.status, 'cancelled');
  assert.equal(saved!.result.items[0]!.title, ''); assert.equal((await f.store.operations()).length, 0);
  f.adapter.loaded.clear(); await new ArchiveService(f.adapter, f.store).initialize();
  assert.equal(await present(group.members[0]!.directory), true);
  assert.equal((await f.service.execute(preview.id, requestId)).items[0]!.status, 'cancelled');
});

test('changed pending content invalidates the original durable receipt and keeps the changed log', async t => {
  const f = await fixture(); t.after(f.close); const group = await f.add('one'); f.adapter.loaded.add('one');
  const preview = await f.service.preview('trash', ['one']); const requestId = randomUUID();
  await f.service.execute(preview.id, requestId);
  const path = join(group.members[0]!.directory, 'session.v4.jsonl'); await appendFile(path, '{"changedSyntheticData":true}\n');
  const changed = await readFile(path, 'utf8'); f.adapter.loaded.clear();
  const restarted = new ArchiveService(f.adapter, f.store); await restarted.initialize();
  const saved = await new RequestJournal(f.store.root).load(requestId);
  assert.equal(saved!.complete, true); assert.equal(saved!.result.items[0]!.status, 'failed');
  assert.equal(saved!.result.items[0]!.code, 'source-changed'); assert.equal(saved!.result.items[0]!.title, '');
  assert.equal((await f.store.operations()).length, 0); assert.equal(await readFile(path, 'utf8'), changed);
  assert.equal((await restarted.list()).archived[0]!.pending, undefined);
});

test('recovery refuses a journal that points one session identity at a different valid session path', async t => {
  const f = await fixture(); t.after(f.close); const one = await f.add('one'); const neighbor = await f.add('neighbor');
  const onePath = join(one.members[0]!.directory, 'session.v4.jsonl');
  const neighborPath = join(neighbor.members[0]!.directory, 'session.v4.jsonl');
  const oneBytes = await readFile(onePath); const neighborBytes = await readFile(neighborPath);
  const corrupted = await f.adapter.inspect('one'); corrupted.members[0]!.directory = neighbor.members[0]!.directory;
  await seedOperation(f, 'moving', corrupted);
  await assert.rejects(new ArchiveService(f.adapter, f.store).initialize(), /expected layout/);
  assert.deepEqual(await readFile(onePath), oneBytes); assert.deepEqual(await readFile(neighborPath), neighborBytes);
  assert.equal(f.adapter.archived.has('one'), true); assert.equal(f.adapter.archived.has('neighbor'), true);
  assert.equal(f.adapter.locks, 0);
});

test('oversized pending metadata creates no journal and leaves source bytes and registry intact', async t => {
  const f = await fixture(); t.after(f.close); const original = await f.add('one');
  const path = join(original.members[0]!.directory, 'session.v4.jsonl'); const before = await readFile(path);
  const oversized = await f.adapter.inspect('one'); oversized.members[0]!.header.syntheticOversizedMetadata = 'S'.repeat(9 * 1024 * 1024);
  await assert.rejects(f.store.queue(oversized, 'Synthetic oversized pending request'), { code: 'metadata-too-large' });
  assert.deepEqual(await readdir(join(f.store.root, 'operations')), []);
  assert.deepEqual(await f.store.operations(), []); assert.deepEqual(await f.store.list(), []);
  assert.deepEqual(await readFile(path), before); assert.equal(f.adapter.archived.has('one'), true);
});
