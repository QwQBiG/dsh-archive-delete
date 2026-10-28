import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RequestJournal, type RequestContext } from '../src/request-journal.js';

function context(): RequestContext {
  return { preview: { id: randomUUID(), action: 'trash', expiresAt: Date.now() + 60_000,
    items: ['one', 'two'].map(id => ({ id, title: `Private ${id}`, sessionId: id, memberIds: [id], sizeBytes: 1, disposition: 'ready' })) },
    groups: {}, fingerprints: { one: 'one-version', two: 'two-version' } };
}
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-request-journal-'));
  await mkdir(join(root, 'receipts'), { mode: 0o700 });
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, journal: new RequestJournal(root) };
}
test('durable intent and per-item results survive a new journal instance', async t => {
  const { root, journal } = await fixture(t); const id = randomUUID(); const ctx = context();
  await journal.begin(id, 'fingerprint', ctx);
  await journal.record(id, { id: 'one', title: 'Private one', status: 'moved' });
  const restarted = new RequestJournal(root); const saved = await restarted.load(id, 'fingerprint');
  assert.equal(saved?.complete, false); assert.deepEqual(saved?.preview, ctx.preview);
  assert.equal(saved?.result.items[0]?.status, 'moved'); assert.equal((await restarted.incomplete()).length, 1);
  const result = await restarted.complete(id, true);
  assert.deepEqual(result.counts, { succeeded: 1, pending: 0, skipped: 0, failed: 1 });
  assert.equal(result.items[1]?.code, 'operation-interrupted'); assert.equal((await restarted.incomplete()).length, 0);
});
test('duplicate begin and writes retain one stable result and conflicting fingerprints refuse', async t => {
  const { journal } = await fixture(t); const id = randomUUID(); const ctx = context();
  await Promise.all([journal.begin(id, 'same', ctx), journal.begin(id, 'same', context())]);
  await assert.rejects(journal.begin(id, 'different', ctx), /already used/);
  await assert.rejects(journal.load(id, 'different'), /already used/);
  const item = { id: 'one', title: 'Private one', status: 'moved' as const };
  await Promise.all([journal.record(id, item), journal.record(id, item)]);
  assert.equal((await journal.load(id))?.result.items.length, 1);
  await assert.rejects(journal.complete(id), /no durable result/);
  await journal.record(id, { id: 'two', title: 'Private two', status: 'pending' });
  const first = await journal.complete(id); assert.deepEqual(await journal.complete(id), first);
  assert.deepEqual((await journal.begin(id, 'same', ctx)).result, first);
});
test('completion redacts recovery content and queued-result updates stay redacted', async t => {
  const { root, journal } = await fixture(t); const id = randomUUID();
  await journal.begin(id, 'same', context());
  await journal.record(id, { id: 'one', title: 'Private one', status: 'pending' });
  await journal.record(id, { id: 'two', title: 'Private two', status: 'skipped', code: 'active' });
  await journal.complete(id);
  let serialized = await readFile(join(root, 'receipts', `${id}.json`), 'utf8');
  assert.equal(serialized.includes('Private'), false); assert.equal(serialized.includes('groups'), false);
  assert.equal(serialized.includes('fingerprints'), false); assert.equal(serialized.includes('preview'), false);
  const updated = await journal.record(id, { id: 'one', title: 'Private one', status: 'moved' });
  assert.equal(updated.complete, true); assert.equal(updated.result.items[0]?.title, '');
  assert.deepEqual(updated.result.counts, { succeeded: 1, pending: 0, skipped: 1, failed: 0 });
  serialized = await readFile(join(root, 'receipts', `${id}.json`), 'utf8'); assert.equal(serialized.includes('Private'), false);
  assert.equal((await journal.recent())[0]?.items[0]?.status, 'moved');
});
test('unknown targets, traversal, unsafe receipts and corrupt state fail closed', async t => {
  const { root, journal } = await fixture(t); const id = randomUUID(); await journal.begin(id, 'same', context());
  await assert.rejects(journal.record(id, { id: 'neighbor', title: '', status: 'moved' }), /does not belong/);
  await assert.rejects(journal.load('../escape'), /valid request/);
  const linked = randomUUID(); const outside = join(root, 'outside.json'); await writeFile(outside, 'private');
  await symlink(outside, join(root, 'receipts', `${linked}.json`)); await assert.rejects(journal.load(linked));
  const corrupt = randomUUID(); await writeFile(join(root, 'receipts', `${corrupt}.json`), '{broken');
  await assert.rejects(journal.load(corrupt), /could not be read/); assert.equal(await readFile(outside, 'utf8'), 'private');
});
test('crash-left private atomic temporaries never retain recovery titles after completion', async t => {
  const { root, journal } = await fixture(t); const id = randomUUID(); await journal.begin(id, 'same', context());
  const temporary = join(root, 'receipts', `${id}.json.${randomUUID()}.tmp`);
  await writeFile(temporary, 'Private crash-left preview', { mode: 0o600 });
  await journal.complete(id, true); await assert.rejects(readFile(temporary), { code: 'ENOENT' });
  const orphan = join(root, 'receipts', `${randomUUID()}.json.${randomUUID()}.tmp`);
  await writeFile(orphan, 'Private intent that never became canonical', { mode: 0o600 });
  assert.equal((await new RequestJournal(root).incomplete()).length, 0);
  await assert.rejects(readFile(orphan), { code: 'ENOENT' });
});
test('cancel intent uses trash selection context with a stable cancel result', async t => {
  const { root, journal } = await fixture(t); const id = randomUUID(); const ctx = context();
  const intent = await journal.begin(id, 'cancel:one,two', ctx, 'cancel'); assert.equal(intent.result.action, 'cancel');
  await journal.record(id, { id: 'one', title: '', status: 'cancelled' });
  await journal.record(id, { id: 'two', title: '', status: 'skipped' });
  const answer = await journal.complete(id); assert.equal(answer.action, 'cancel');
  assert.deepEqual(answer.counts, { succeeded: 1, pending: 0, skipped: 1, failed: 0 });
  assert.deepEqual((await new RequestJournal(root).load(id, 'cancel:one,two'))?.result, answer);
});

test('oversized request intent is refused before creating any canonical or temporary receipt', async t => {
  const { root, journal } = await fixture(t); const ctx = context();
  ctx.preview.items[0]!.title = 'S'.repeat(7 * 1024 * 1024);
  await assert.rejects(journal.begin(randomUUID(), 'oversized-intent', ctx), { code: 'metadata-too-large' });
  assert.deepEqual(await readdir(join(root, 'receipts')), []);
  assert.deepEqual(await journal.incomplete(), []);
});

test('an admitted near-limit intent can durably record all 100 worst-escaped bounded outcomes', async t => {
  const { root, journal } = await fixture(t); const id = randomUUID(); const fingerprint = 'reserved-result-headroom';
  const ctx = context(); ctx.preview.items = Array.from({ length: 100 }, (_, index) => {
    const target = `${String(index).padStart(3, '0')}${'\0'.repeat(509)}`;
    return { id: target, title: '', sessionId: target, memberIds: [target], sizeBytes: 1, disposition: 'ready' };
  });
  ctx.fingerprints = { padding: '' };
  const initial = { schema: 1, requestId: id, fingerprint, complete: false, ...ctx,
    result: { operationId: id, action: 'trash', items: [], counts: { succeeded: 0, pending: 0, skipped: 0, failed: 0 } } };
  const targetBytes = 6 * 1024 * 1024 - 64;
  ctx.fingerprints.padding = 'P'.repeat(targetBytes - Buffer.byteLength(`${JSON.stringify(initial)}\n`));
  await journal.begin(id, fingerprint, ctx);
  const path = join(root, 'receipts', `${id}.json`);
  assert.equal(Buffer.byteLength(await readFile(path)), targetBytes);
  for (const target of ctx.preview.items) await journal.record(id, {
    id: target.id, title: '\0'.repeat(300), status: 'failed', code: '\0'.repeat(100), message: '\0'.repeat(1300),
  });
  const recorded = await new RequestJournal(root).load(id, fingerprint);
  assert.equal(recorded!.result.items.length, 100);
  assert.ok(recorded!.result.items.every(item => item.title.length === 256 && item.code!.length === 80 && item.message!.length === 1024));
  assert.ok(Buffer.byteLength(await readFile(path)) <= 8 * 1024 * 1024);
  const finished = await journal.complete(id);
  assert.deepEqual(finished.counts, { succeeded: 0, pending: 0, skipped: 0, failed: 100 });
  assert.ok(finished.items.every(item => item.title === ''));
  assert.equal((await new RequestJournal(root).load(id))!.complete, true);
});
