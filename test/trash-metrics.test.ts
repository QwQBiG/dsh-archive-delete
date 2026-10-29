import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { appendFile, lstat, mkdir, readFile, readdir, rm, rmdir, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fixture } from './fixtures.js';
import type { Manifest } from '../src/storage.js';
import type { SessionGroup } from '../src/contracts.js';

type Fixture = Awaited<ReturnType<typeof fixture>>;
async function trashed(t: TestContext, children: string[] = [], prepare?: (f: Fixture, group: SessionGroup) => Promise<void>) {
  const f = await fixture(); t.after(f.close); const group = await f.add('parent', children);
  await prepare?.(f, group);
  const operation = await f.store.prepareTrash(group); await f.store.markDetached(operation);
  await f.store.commitTrash(operation); await f.store.finish(operation);
  return { ...f, group, entryId: operation.entryId, entry: join(f.store.root, 'trash', operation.entryId) };
}

test('trash metrics use current log and temporary bytes, keep historic metadata, and exclude lock bytes', async t => {
  const f = await trashed(t, [], async (_fixture, group) => {
    const member = group.members[0]!; member.sizeBytes = 99_999;
    await writeFile(join(member.directory, 'session.v3.jsonl'), Buffer.alloc(7));
    await writeFile(join(member.directory, 'session.migration.synthetic.tmp'), Buffer.alloc(11));
    await writeFile(join(member.directory, 'session.lock'), Buffer.alloc(31));
  });
  const member = join(f.entry, '0'); const currentLog = Number((await lstat(join(member, 'session.v4.jsonl'))).size);
  const before = await f.store.entrySnapshot(f.entryId);
  assert.equal(before.manifest.group.members[0]!.sizeBytes, 99_999);
  assert.equal(before.logBytes, currentLog + 7); assert.equal(before.sizeBytes, currentLog + 7 + 11); assert.equal(before.fileCount, 3);
  assert.equal((await f.store.list())[0]!.sizeBytes, before.sizeBytes);
  assert.equal(await f.store.entryFingerprint(f.entryId), before.fingerprint);
  await appendFile(join(member, 'session.v4.jsonl'), 'more');
  const after = await f.store.entrySnapshot(f.entryId);
  assert.equal(after.sizeBytes, before.sizeBytes + 4); assert.equal(after.logBytes, before.logBytes + 4);
  assert.notEqual(after.fingerprint, before.fingerprint); assert.equal(after.manifest.group.members[0]!.sizeBytes, 99_999);
  await appendFile(join(member, 'session.lock'), 'new lock bytes');
  assert.equal((await f.store.entrySnapshot(f.entryId)).fingerprint, after.fingerprint);
});

test('live metrics follow remaining old generations and missing members after an interrupted purge', async t => {
  const f = await trashed(t, ['child'], async (_fixture, group) => {
    await writeFile(join(group.members[0]!.directory, 'session.v3.jsonl'), Buffer.alloc(19));
  });
  const initial = await f.store.entrySnapshot(f.entryId);
  const operation = { schema: 1, id: randomUUID(), entryId: f.entryId, phase: 'purging', group: initial.manifest.group, createdAt: Date.now(), moved: [] };
  await writeFile(join(f.store.root, 'operations', `${operation.id}.json`), JSON.stringify(operation), { mode: 0o600 });
  await unlink(join(f.entry, '0', 'session.v4.jsonl')); await rm(join(f.entry, '1'), { recursive: true });
  const remaining = await f.store.entrySnapshot(f.entryId);
  assert.equal(remaining.sizeBytes, 19); assert.equal(remaining.logBytes, 19); assert.equal(remaining.fileCount, 1);
  assert.equal((await f.store.list())[0]!.sizeBytes, 19); assert.notEqual(initial.fingerprint, remaining.fingerprint);
  assert.deepEqual(remaining.manifest, initial.manifest);
  await unlink(join(f.entry, '0', 'session.v3.jsonl'));
  const emptyMember = await f.store.entrySnapshot(f.entryId); assert.equal(emptyMember.sizeBytes, 0); assert.equal(emptyMember.fileCount, 0);
  await rmdir(join(f.entry, '0'));
  const missingMember = await f.store.entrySnapshot(f.entryId);
  assert.equal(missingMember.sizeBytes, 0); assert.notEqual(missingMember.fingerprint, emptyMember.fingerprint);
});

test('restore and purge previews use the same live measurement as their consent fingerprint', async t => {
  const f = await trashed(t, [], async (_fixture, group) => { group.members[0]!.sizeBytes = 99_999; });
  const snapshot = await f.store.entrySnapshot(f.entryId);
  for (const action of ['restore', 'purge'] as const) {
    const preview = await f.service.preview(action, [f.entryId]);
    assert.equal(preview.items[0]!.disposition, 'ready');
    assert.equal(preview.items[0]!.sizeBytes, snapshot.sizeBytes);
  }
  const operation = { schema: 1, id: randomUUID(), entryId: f.entryId, phase: 'purging', group: snapshot.manifest.group, createdAt: Date.now(), moved: [] };
  await writeFile(join(f.store.root, 'operations', `${operation.id}.json`), JSON.stringify(operation), { mode: 0o600 });
  await unlink(join(f.entry, '0', 'session.v4.jsonl'));
  const preview = await f.service.preview('purge', [f.entryId]);
  assert.equal(preview.items[0]!.sizeBytes, 0);
  assert.equal(preview.items[0]!.disposition, 'ready');
  assert.equal((await f.service.execute(preview.id, randomUUID())).items[0]!.status, 'purged');
});

test('missing members require a matching permanent deletion journal', async t => {
  const f = await trashed(t, ['child']); const manifest = await f.store.manifest(f.entryId);
  await rm(join(f.entry, '1'), { recursive: true });
  await assert.rejects(f.store.entrySnapshot(f.entryId), { code: 'corrupt-state' });
  const differentGroup = structuredClone(manifest.group); differentGroup.members[0]!.revision = 'different';
  const operation = { schema: 1, id: randomUUID(), entryId: f.entryId, phase: 'purging', group: differentGroup, createdAt: Date.now(), moved: [] };
  await writeFile(join(f.store.root, 'operations', `${operation.id}.json`), JSON.stringify(operation), { mode: 0o600 });
  await assert.rejects(f.store.entrySnapshot(f.entryId), { code: 'corrupt-state' });
});

test('unexpected files and owned-name links fail closed without changing their targets', async t => {
  const f = await trashed(t); const unexpected = join(f.entry, '0', 'unowned.bin'); await writeFile(unexpected, 'keep');
  await assert.rejects(f.store.entrySnapshot(f.entryId), { code: 'unknown-file' });
  await assert.rejects(f.store.list(), { code: 'unknown-file' }); assert.equal(await readFile(unexpected, 'utf8'), 'keep'); await unlink(unexpected);
  const outside = join(f.root, 'outside'); await mkdir(outside); const target = join(outside, 'keep'); await writeFile(target, 'retained');
  const alias = join(f.entry, '0', 'session.v3.jsonl');
  try { await symlink(target, alias, 'file'); }
  catch (error) { if (process.platform !== 'win32' || (error as NodeJS.ErrnoException).code !== 'EPERM') throw error; await symlink(outside, alias, 'junction'); }
  await assert.rejects(f.store.entrySnapshot(f.entryId), error => ['unknown-file', 'unsafe-path'].includes((error as { code: string }).code));
  assert.equal(await readFile(target, 'utf8'), 'retained'); assert.deepEqual(await readdir(outside), ['keep']);
});

test('a log modified between measurement and final verification never returns mixed metrics and consent', async t => {
  const f = await trashed(t); const manifest = f.store.manifest.bind(f.store); let reads = 0;
  f.store.manifest = async key => {
    const result = await manifest(key);
    if (++reads === 2) await appendFile(join(f.entry, '0', 'session.v4.jsonl'), 'concurrent change');
    return result;
  };
  await assert.rejects(f.store.entrySnapshot(f.entryId), { code: 'source-changed' });
  assert.equal(reads, 2); assert.ok((await readFile(join(f.entry, '0', 'session.v4.jsonl'), 'utf8')).endsWith('concurrent change'));
});

test('manifest replacement and new container entries during measurement require fresh consent', async t => {
  for (const change of ['manifest', 'unknown-entry'] as const) {
    const f = await trashed(t); const original = f.store.manifest.bind(f.store); let reads = 0;
    f.store.manifest = async key => {
      const result: Manifest = await original(key);
      if (++reads === 2) {
        if (change === 'manifest') await writeFile(join(f.entry, 'manifest.json'), JSON.stringify({ ...result, trashedAt: result.trashedAt + 1 }));
        else await writeFile(join(f.entry, 'unowned'), 'retained');
      }
      return result;
    };
    await assert.rejects(f.store.entrySnapshot(f.entryId), { code: 'source-changed' });
    if (change === 'unknown-entry') assert.equal(await readFile(join(f.entry, 'unowned'), 'utf8'), 'retained');
  }
});
