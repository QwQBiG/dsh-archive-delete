import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ArchiveService } from '../src/service.js';
import { ArchiveError } from '../src/contracts.js';
import { RequestJournal } from '../src/request-journal.js';
import { fixture } from './fixtures.js';

function injected(pattern: RegExp): (error: unknown) => boolean {
  return error => (error instanceof Error && pattern.test(error.message))
    || (error instanceof ArchiveError && error.code === 'operation-failed'
      && 'mutationOutcome' in error && error.mutationOutcome === 'unconfirmed');
}

async function queued(f: Awaited<ReturnType<typeof fixture>>, id: string) {
  const group = await f.add(id); f.adapter.loaded.add(id);
  const preview = await f.service.preview('trash', [id]); const requestId = randomUUID();
  assert.equal((await f.service.execute(preview.id, requestId)).items[0]!.status, 'pending');
  return { group, requestId };
}

for (const stage of ['intent', 'original-result', 'queue-removal'] as const) {
  test(`cancel recovery: interruption after ${stage} does not execute the cancelled move`, async t => {
    const f = await fixture(); t.after(f.close); const { group, requestId } = await queued(f, 'cancelled');
    const bytes = await readFile(join(group.members[0]!.directory, 'session.v4.jsonl'));
    const cancelId = randomUUID();
    const journal = (f.service as unknown as { requests: RequestJournal }).requests;
    const begin = journal.begin.bind(journal); const record = journal.record.bind(journal); const finish = f.store.finish.bind(f.store);
    if (stage === 'intent') journal.begin = async (...args) => {
      const value = await begin(...args); if (args[0] === cancelId) throw new Error('Injected cancellation interruption'); return value;
    };
    if (stage === 'original-result') f.store.finish = async op => {
      if (op.phase === 'pending') throw new Error('Injected cancellation interruption'); await finish(op);
    };
    if (stage === 'queue-removal') journal.record = async (id, item) => {
      if (id === cancelId) throw new Error('Injected cancellation interruption'); return record(id, item);
    };
    await assert.rejects(f.service.cancelPending(['cancelled'], cancelId), injected(/Injected cancellation interruption/));
    journal.begin = begin; journal.record = record; f.store.finish = finish; f.adapter.loaded.clear();
    const restarted = new ArchiveService(f.adapter, f.store); await restarted.initialize();
    assert.equal((await f.store.list()).length, 0);
    assert.deepEqual(await readFile(join(group.members[0]!.directory, 'session.v4.jsonl')), bytes);
    assert.equal((await f.store.operations()).length, 0);
    assert.equal((await new RequestJournal(f.store.root).load(requestId))!.result.items[0]!.status, 'cancelled');
    const receipt = await new RequestJournal(f.store.root).load(cancelId);
    assert.equal(receipt!.complete, true); assert.equal(receipt!.result.items[0]!.status, 'cancelled');
    assert.equal(receipt!.cancelTargets, undefined, 'completed receipts discard cancellation context');
    assert.deepEqual(await restarted.cancelPending(['cancelled'], cancelId), receipt!.result);
  });
}

test('cancel recovery: a continuing cancellation failure holds only its own queued target', async t => {
  const f = await fixture(); t.after(f.close); const cancelled = await queued(f, 'cancelled'); await queued(f, 'unrelated');
  const cancelId = randomUUID(); const finish = f.store.finish.bind(f.store);
  f.store.finish = async op => {
    if (op.phase === 'pending' && op.group.sessionId === 'cancelled') throw new Error('Injected persistent cancellation failure');
    await finish(op);
  };
  await assert.rejects(f.service.cancelPending(['cancelled'], cancelId), injected(/persistent cancellation failure/));
  f.adapter.loaded.clear(); const restarted = new ArchiveService(f.adapter, f.store); await restarted.initialize();
  assert.deepEqual((await f.store.list()).map(item => item.sessionId), ['unrelated']);
  assert.match(await readFile(join(cancelled.group.members[0]!.directory, 'session.v4.jsonl'), 'utf8'), /Synthetic test data/);
  assert.equal((await new RequestJournal(f.store.root).load(cancelId))!.complete, false);
  f.store.finish = finish; const recovered = new ArchiveService(f.adapter, f.store); await recovered.initialize();
  assert.equal((await f.store.operations()).length, 0);
  assert.equal((await new RequestJournal(f.store.root).load(cancelId))!.result.items[0]!.status, 'cancelled');
});

test('cancel recovery: a legacy incomplete cancellation pauses the queue until a fresh confirmation', async t => {
  const f = await fixture(); t.after(f.close); await queued(f, 'legacy'); const cancelId = randomUUID();
  const journal = (f.service as unknown as { requests: RequestJournal }).requests; const begin = journal.begin.bind(journal);
  journal.begin = async (...args) => { await begin(...args); throw new Error('Injected intent publication loss'); };
  await assert.rejects(f.service.cancelPending(['legacy'], cancelId), injected(/publication loss/)); journal.begin = begin;
  const path = join(f.store.root, 'receipts', `${cancelId}.json`);
  const old = JSON.parse(await readFile(path, 'utf8')); delete old.cancelTargets; delete old.cancelSupersedes; await writeFile(path, JSON.stringify(old));
  f.adapter.loaded.clear(); const restarted = new ArchiveService(f.adapter, f.store); await restarted.initialize();
  assert.equal((await f.store.list()).length, 0);
  assert.equal((await new RequestJournal(f.store.root).load(cancelId))!.complete, false);
  assert.equal((await restarted.list()).recentResults[0]!.items[0]!.code, 'cancel-review-required');
  assert.equal((await restarted.cancelPending(['legacy'], cancelId)).items[0]!.status, 'cancelled');
  assert.equal((await f.store.operations()).length, 0);
});

test('cancel recovery: retiring one legacy batch target does not pause its newly confirmed queue', async t => {
  const f = await fixture(); t.after(f.close); await queued(f, 'first'); await queued(f, 'second'); const cancelId = randomUUID();
  const journal = (f.service as unknown as { requests: RequestJournal }).requests; const begin = journal.begin.bind(journal);
  journal.begin = async (...args) => { await begin(...args); throw new Error('Injected legacy intent loss'); };
  await assert.rejects(f.service.cancelPending(['first', 'second'], cancelId), injected(/legacy intent loss/)); journal.begin = begin;
  const path = join(f.store.root, 'receipts', `${cancelId}.json`); const old = JSON.parse(await readFile(path, 'utf8'));
  delete old.cancelTargets; delete old.cancelSupersedes; await writeFile(path, JSON.stringify(old));
  await f.service.cancelPending(['first'], randomUUID());
  const preview = await f.service.preview('trash', ['first']); await f.service.execute(preview.id, randomUUID());
  f.adapter.loaded.clear(); const restarted = new ArchiveService(f.adapter, f.store); await restarted.initialize();
  assert.deepEqual((await f.store.list()).map(item => item.sessionId), ['first']);
  assert.deepEqual((await f.store.operations()).filter(op => op.phase === 'pending').map(op => op.group.sessionId), ['second']);
  const saved = (await new RequestJournal(f.store.root).load(cancelId))!;
  assert.equal(saved.complete, false); assert.equal(saved.result.items[0]!.id, 'first'); assert.equal(saved.result.items[0]!.status, 'skipped');
});

test('cancel recovery: targets without a pending operation remain skipped on replay', async t => {
  const f = await fixture(); t.after(f.close); const id = randomUUID();
  const result = await f.service.cancelPending(['absent'], id);
  assert.equal(result.items[0]!.status, 'skipped');
  assert.deepEqual(await f.service.cancelPending(['absent'], id), result);
});

test('cancel recovery: malformed queue identities are rejected before cancellation changes a queue', async t => {
  const f = await fixture(); t.after(f.close); await queued(f, 'protected'); const cancelId = randomUUID();
  const journal = (f.service as unknown as { requests: RequestJournal }).requests; const begin = journal.begin.bind(journal);
  journal.begin = async (...args) => { await begin(...args); throw new Error('Injected intent loss'); };
  await assert.rejects(f.service.cancelPending(['protected'], cancelId), injected(/intent loss/)); journal.begin = begin;
  const path = join(f.store.root, 'receipts', `${cancelId}.json`); const initial = JSON.parse(await readFile(path, 'utf8'));
  const pendingId = (await f.store.operations())[0]!.id;
  for (const cancelTargets of [{ protected: ['not-an-operation-id'] }, { other: [randomUUID()] }, { protected: [pendingId, pendingId] }]) {
    await writeFile(path, JSON.stringify({ ...initial, cancelTargets }));
    await assert.rejects(f.service.cancelPending(['protected'], cancelId), { code: 'corrupt-state' });
    assert.equal((await f.store.operations()).length, 1);
  }
});

test('cancel recovery: retry keeps completed batch targets and cancels the remaining targets', async t => {
  const f = await fixture(); t.after(f.close); await queued(f, 'first'); await queued(f, 'second');
  const cancelId = randomUUID(); const finish = f.store.finish.bind(f.store);
  f.store.finish = async op => {
    if (op.phase === 'pending' && op.group.sessionId === 'second') throw new Error('Injected second target interruption'); await finish(op);
  };
  await assert.rejects(f.service.cancelPending(['first', 'second'], cancelId), injected(/second target interruption/));
  f.store.finish = finish; f.adapter.loaded.clear(); const restarted = new ArchiveService(f.adapter, f.store); await restarted.initialize();
  assert.equal((await f.store.list()).length, 0);
  const receipt = (await new RequestJournal(f.store.root).load(cancelId))!;
  assert.deepEqual(receipt.result.items.map(item => item.status), ['cancelled', 'cancelled']);
  assert.deepEqual(receipt.result.counts, { succeeded: 2, pending: 0, skipped: 0, failed: 0 });
});

test('cancel recovery: an old cancellation does not cancel a newly confirmed queue for the same session', async t => {
  const f = await fixture(); t.after(f.close); await queued(f, 'same'); const cancelId = randomUUID();
  const journal = (f.service as unknown as { requests: RequestJournal }).requests; const record = journal.record.bind(journal);
  journal.record = async (id, item) => { if (id === cancelId) throw new Error('Injected result loss'); return record(id, item); };
  await assert.rejects(f.service.cancelPending(['same'], cancelId), injected(/result loss/)); journal.record = record;
  const preview = await f.service.preview('trash', ['same']); const newRequest = randomUUID();
  assert.equal((await f.service.execute(preview.id, newRequest)).items[0]!.status, 'pending');
  f.adapter.loaded.clear(); const restarted = new ArchiveService(f.adapter, f.store); await restarted.initialize();
  assert.equal((await f.store.list())[0]!.sessionId, 'same');
  assert.equal((await new RequestJournal(f.store.root).load(cancelId))!.result.items[0]!.status, 'cancelled');
  assert.equal((await new RequestJournal(f.store.root).load(newRequest))!.result.items[0]!.status, 'moved');
});

async function legacyCancellation(f: Awaited<ReturnType<typeof fixture>>, ids: string[]) {
  const journal = (f.service as unknown as { requests: RequestJournal }).requests;
  const requestId = randomUUID(); const begin = journal.begin.bind(journal);
  journal.begin = async (...args) => {
    const value = await begin(...args);
    if (args[0] === requestId) throw new Error('Injected legacy cancellation publication loss');
    return value;
  };
  try { await assert.rejects(f.service.cancelPending(ids, requestId), injected(/legacy cancellation publication loss/)); }
  finally { journal.begin = begin; }
  const path = join(f.store.root, 'receipts', `${requestId}.json`);
  const old = JSON.parse(await readFile(path, 'utf8'));
  delete old.cancelTargets; delete old.cancelSupersedes;
  await writeFile(path, JSON.stringify(old));
  return requestId;
}

test('cancel recovery: replaying a completed cancellation cannot retire a later legacy intent', async t => {
  const f = await fixture(); t.after(f.close); await queued(f, 'same');
  const completed = randomUUID(); await f.service.cancelPending(['same'], completed);
  const preview = await f.service.preview('trash', ['same']); await f.service.execute(preview.id, randomUUID());
  const later = await legacyCancellation(f, ['same']);
  const journal = new RequestJournal(f.store.root);
  assert.equal((await journal.load(later))!.complete, false);
  await f.service.cancelPending(['same'], completed);
  assert.equal((await journal.load(later))!.complete, false, 'an old completed replay must not supersede a later cancellation');
  f.adapter.loaded.clear(); const restarted = new ArchiveService(f.adapter, f.store); await restarted.initialize();
  assert.deepEqual(await f.store.list(), []);
  assert.deepEqual((await f.store.operations()).filter(op => op.phase === 'pending').map(op => op.group.sessionId), ['same']);
});

test('cancel recovery: interrupted legacy retirement retries its original set without superseding later consent', async t => {
  const f = await fixture(); t.after(f.close); await queued(f, 'same');
  const originalLegacy = await legacyCancellation(f, ['same']); const cancelling = randomUUID();
  const journal = (f.service as unknown as { requests: RequestJournal }).requests;
  const record = journal.record.bind(journal);
  journal.record = async (id, item) => {
    if (id === originalLegacy && item.status === 'skipped') throw new Error('Injected legacy retirement interruption');
    return record(id, item);
  };
  try { await assert.rejects(f.service.cancelPending(['same'], cancelling), injected(/legacy retirement interruption/)); }
  finally { journal.record = record; }
  assert.equal((await journal.load(cancelling))!.complete, false, 'retirement must finish before cancellation is completed');
  assert.equal((await journal.load(originalLegacy))!.complete, false);
  const preview = await f.service.preview('trash', ['same']); await f.service.execute(preview.id, randomUUID());
  const laterLegacy = await legacyCancellation(f, ['same']);
  assert.equal((await f.service.cancelPending(['same'], cancelling)).items[0]!.status, 'cancelled');
  assert.equal((await journal.load(originalLegacy))!.complete, true);
  assert.equal((await journal.load(laterLegacy))!.complete, false, 'retry must not widen the persisted retirement set');
  f.adapter.loaded.clear(); const restarted = new ArchiveService(f.adapter, f.store); await restarted.initialize();
  assert.deepEqual(await f.store.list(), []);
  assert.deepEqual((await f.store.operations()).filter(op => op.phase === 'pending').map(op => op.group.sessionId), ['same']);
});
