import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { ArchiveService } from '../src/service.js';
import { fixture, present } from './fixtures.js';

test('manual confirmation releases an idle group, then trashes and purges in the same service without restart', async () => {
  const f = await fixture();
  try {
    const group = await f.add('idle-parent', ['idle-child']);
    const fork = await f.add('independent-fork');
    const forkFile = join(fork.members[0]!.directory, 'session.v4.jsonl'); const forkBytes = await readFile(forkFile);
    group.members.forEach(member => f.adapter.loaded.add(member.id)); f.adapter.canReleaseIdle = true;
    const preview = await f.service.preview('trash', [group.sessionId]);
    assert.equal(preview.items[0]!.disposition, 'pending'); assert.equal(f.adapter.releases, 0);
    const moved = await f.service.execute(preview.id, randomUUID());
    assert.equal(moved.items[0]!.status, 'moved'); assert.equal(moved.counts.pending, 0); assert.equal(f.adapter.releases, 1);
    for (const member of group.members) assert.equal(await present(member.directory), false);
    const entry = (await f.service.list()).trash[0]!;
    const purge = await f.service.preview('purge', [entry.id]);
    assert.equal((await f.service.execute(purge.id, randomUUID())).items[0]!.status, 'purged');
    assert.equal((await f.service.list()).trash.length, 0);
    assert.deepEqual(await readFile(forkFile), forkBytes);
  } finally { await f.close(); }
});

test('active work and external ownership cannot trigger idle release or delete source bytes', async () => {
  const f = await fixture();
  try {
    const group = await f.add('protected'); const file = join(group.members[0]!.directory, 'session.v4.jsonl'); const bytes = await readFile(file);
    f.adapter.loaded.add(group.sessionId); f.adapter.canReleaseIdle = true; f.adapter.active.add(group.sessionId);
    let preview = await f.service.preview('trash', [group.sessionId]);
    assert.equal((await f.service.execute(preview.id, randomUUID())).items[0]!.status, 'skipped');
    f.adapter.active.clear(); f.adapter.busy.add(group.sessionId);
    preview = await f.service.preview('trash', [group.sessionId]);
    assert.equal((await f.service.execute(preview.id, randomUUID())).items[0]!.code, 'busy');
    assert.equal(f.adapter.releases, 0); assert.deepEqual(await readFile(file), bytes);
  } finally { await f.close(); }
});

test('bytes changed by a lifecycle flush require a fresh confirmation before any move', async () => {
  const f = await fixture();
  try {
    const group = await f.add('flush-drift'); const file = join(group.members[0]!.directory, 'session.v4.jsonl');
    f.adapter.loaded.add(group.sessionId);
    f.adapter.releaseIdle = async () => { await appendFile(file, 'newly flushed data\n'); f.adapter.loaded.clear(); return true; };
    const preview = await f.service.preview('trash', [group.sessionId]);
    const result = await f.service.execute(preview.id, randomUUID());
    assert.equal(result.items[0]!.code, 'source-changed'); assert.equal(result.items[0]!.status, 'failed');
    assert.equal((await f.service.list()).trash.length, 0); assert.match(await readFile(file, 'utf8'), /newly flushed data/);
    const fresh = await f.service.preview('trash', [group.sessionId]);
    assert.equal((await f.service.execute(fresh.id, randomUUID())).items[0]!.status, 'moved');
  } finally { await f.close(); }
});

test('an external writer appearing after idle release prevents the move', async () => {
  const f = await fixture();
  try {
    const group = await f.add('new-writer'); f.adapter.loaded.add(group.sessionId);
    f.adapter.releaseIdle = async () => { f.adapter.loaded.clear(); f.adapter.busy.add(group.sessionId); return true; };
    const preview = await f.service.preview('trash', [group.sessionId]);
    assert.equal((await f.service.execute(preview.id, randomUUID())).items[0]!.code, 'busy');
    assert.equal(await present(group.members[0]!.directory), true); assert.equal((await f.service.list()).trash.length, 0);
  } finally { await f.close(); }
});

test('old queued requests do not unload sessions at startup; cancel and fresh confirmation can process them now', async () => {
  const f = await fixture();
  try {
    const group = await f.add('already-pending'); f.adapter.loaded.add(group.sessionId);
    const original = randomUUID(); const preview = await f.service.preview('trash', [group.sessionId]);
    assert.equal((await f.service.execute(preview.id, original)).items[0]!.status, 'pending');
    const attempts = f.adapter.releases; f.adapter.canReleaseIdle = true;
    const restarted = new ArchiveService(f.adapter, f.store); await restarted.initialize();
    assert.equal(f.adapter.releases, attempts); assert.equal((await restarted.list()).archived[0]!.pending, true);
    assert.equal((await restarted.cancelPending([group.sessionId], randomUUID())).items[0]!.status, 'cancelled');
    const fresh = await restarted.preview('trash', [group.sessionId]);
    assert.equal((await restarted.execute(fresh.id, randomUUID())).items[0]!.status, 'moved');
    assert.equal((await restarted.list()).recentResults.find(result => result.operationId === original)!.items[0]!.status, 'cancelled');
    await restarted.close();
  } finally { await f.close(); }
});
