import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { ArchiveError, type ArchiveApi } from '../src/contracts.js';
import { ArchiveClientController, ClientTransportError } from '../src/client-state.js';
import { createArchiveApi } from '../src/client.js';
import { createRequestHandler } from '../src/host-routes.js';
import { RequestJournal } from '../src/request-journal.js';
import { fixture, present } from './fixtures.js';

function gateway(api: ArchiveApi) {
  const requests: Array<{ action: string; requestId?: string; previewId?: string }> = [];
  const replies: Array<{ ok: boolean; error?: { code: string; message: string; uncertain?: boolean } }> = [];
  const handler = createRequestHandler(api);
  const client = createArchiveApi(async (url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    const reply = await handler(new Request(String(url), init)); replies.push(await reply.clone().json()); return reply;
  }, 'https://example.test/');
  return { client, requests, replies };
}

for (const typed of [false, true]) {
  test(`a ${typed ? 'typed' : 'generic'} receipt-completion failure preserves the exact move request`, async t => {
    const f = await fixture(); t.after(f.close); const group = await f.add('completed-move');
    const journal = (f.service as unknown as { requests: RequestJournal }).requests;
    const complete = journal.complete.bind(journal); let removals = 0;
    const remove = f.adapter.removeRegistry.bind(f.adapter);
    f.adapter.removeRegistry = async group => { removals++; await remove(group); };
    journal.complete = async () => { throw typed ? new ArchiveError('corrupt-state', 'A receipt needs attention.') : new Error('Private synthetic disk failure'); };
    const g = gateway(f.service); const controller = new ArchiveClientController(g.client); t.after(() => controller.dispose());
    await controller.open(group.sessionId); await controller.confirm();
    assert.equal((await f.store.list()).length, 1); assert.equal(await present(group.members[0]!.directory), false);
    assert.equal(controller.getSnapshot().uncertainRequest, true);
    assert.equal(controller.getSnapshot().error?.code, typed ? 'corrupt-state' : 'operation-failed');
    assert.equal(g.replies.at(-1)!.error?.uncertain, true);
    assert.equal(JSON.stringify(g.replies).includes('Private synthetic'), false);
    // A refusal of this retry says nothing about the first call's effects.
    f.adapter.supported = false; await controller.retryUncertain();
    assert.equal(controller.getSnapshot().uncertainRequest, true);
    f.adapter.supported = true;
    const load = journal.load.bind(journal);
    journal.load = async () => { throw new ArchiveError('corrupt-state', 'The request receipt could not be read.'); };
    await controller.retryUncertain(); assert.equal(controller.getSnapshot().uncertainRequest, true);
    assert.equal(g.replies.at(-1)!.error?.uncertain, undefined, 'an unreadable receipt cannot prove the original request never started');
    journal.load = load; journal.complete = complete; await controller.retryUncertain();
    assert.equal(controller.getSnapshot().result?.items[0]?.status, 'moved');
    assert.equal(controller.getSnapshot().uncertainRequest, false); assert.equal(removals, 1);
    const executions = g.requests.filter(request => request.action === 'execute');
    assert.equal(executions.length, 4);
    assert.ok(executions.every(request => request.requestId === executions[0]!.requestId && request.previewId === executions[0]!.previewId));
  });
}

test('publication that succeeds before reporting failure is retried with the same intent', async t => {
  const f = await fixture(); t.after(f.close); const group = await f.add('publication');
  const journal = (f.service as unknown as { requests: RequestJournal }).requests; const begin = journal.begin.bind(journal);
  journal.begin = async (...args) => { await begin(...args); throw new Error('Private publication sync failure'); };
  const g = gateway(f.service); const controller = new ArchiveClientController(g.client); t.after(() => controller.dispose());
  await controller.open(group.sessionId); await controller.confirm();
  assert.equal(controller.getSnapshot().uncertainRequest, true); assert.equal(await present(group.members[0]!.directory), true);
  journal.begin = begin; await controller.retryUncertain();
  assert.equal(controller.getSnapshot().result?.items[0]?.status, 'moved'); assert.equal((await f.store.list()).length, 1);
  const requests = g.requests.filter(request => request.action === 'execute'); assert.equal(requests.length, 2);
  assert.equal(requests[0]!.requestId, requests[1]!.requestId);
});

test('a cancellation result error can replay the already-cancelled queue', async t => {
  const f = await fixture(); t.after(f.close); const group = await f.add('cancelled'); f.adapter.loaded.add(group.sessionId);
  const preview = await f.service.preview('trash', [group.sessionId]); await f.service.execute(preview.id, randomUUID());
  const journal = (f.service as unknown as { requests: RequestJournal }).requests; const complete = journal.complete.bind(journal);
  journal.complete = async () => { throw new Error('Private cancellation sync failure'); };
  const g = gateway(f.service); const controller = new ArchiveClientController(g.client); t.after(() => controller.dispose());
  await controller.open(); await controller.cancelPending([group.sessionId]);
  assert.equal(controller.getSnapshot().uncertainRequest, true); assert.deepEqual(await f.store.operations(), []);
  assert.equal(await present(group.members[0]!.directory), true);
  journal.complete = complete; await controller.retryUncertain();
  assert.equal(controller.getSnapshot().result?.items[0]?.status, 'cancelled'); assert.equal(controller.getSnapshot().uncertainRequest, false);
  const requests = g.requests.filter(request => request.action === 'cancelPending'); assert.equal(requests.length, 2);
  assert.equal(requests[0]!.requestId, requests[1]!.requestId);
});

for (const reason of ['preview-expired', 'unsupported-host'] as const) {
  test(`a first-attempt ${reason} refusal remains definitive`, async t => {
    const f = await fixture(); t.after(f.close); const group = await f.add('refused');
    const g = gateway(f.service); const controller = new ArchiveClientController(g.client); t.after(() => controller.dispose());
    await controller.open(group.sessionId);
    if (reason === 'preview-expired') (f.service as unknown as { previews: Map<string, unknown> }).previews.clear();
    else f.adapter.supported = false;
    await controller.confirm();
    assert.equal(controller.getSnapshot().uncertainRequest, false); assert.equal(controller.getSnapshot().error?.code, reason);
    assert.equal(g.replies.at(-1)!.error?.uncertain, reason === 'preview-expired' ? false : undefined);
    assert.equal(await present(group.members[0]!.directory), true); assert.deepEqual(await f.store.list(), []);
    await controller.retryUncertain(); assert.equal(g.requests.filter(request => request.action === 'execute').length, 1);
  });
}

test('a recorded per-item refusal remains a completed result', async t => {
  const f = await fixture(); t.after(f.close); const group = await f.add('busy');
  const g = gateway(f.service); const controller = new ArchiveClientController(g.client); t.after(() => controller.dispose());
  await controller.open(group.sessionId); f.adapter.busy.add(group.sessionId); await controller.confirm();
  assert.equal(controller.getSnapshot().uncertainRequest, false); assert.equal(controller.getSnapshot().result?.items[0]?.code, 'busy');
  assert.equal(g.replies.findLast(reply => reply.ok)!.ok, true); assert.equal(await present(group.members[0]!.directory), true);
});

test('a consumed preview can be reviewed again when the original request is proven unpublished', async t => {
  const f = await fixture(); t.after(f.close); const group = await f.add('unpublished');
  const journal = (f.service as unknown as { requests: RequestJournal }).requests; const begin = journal.begin.bind(journal);
  journal.begin = async () => { throw new Error('Private failure before publication'); };
  const g = gateway(f.service); const controller = new ArchiveClientController(g.client); t.after(() => controller.dispose());
  await controller.open(group.sessionId); await controller.confirm();
  assert.equal(controller.getSnapshot().uncertainRequest, true); assert.deepEqual(await f.store.list(), []);
  journal.begin = begin; await controller.retryUncertain();
  assert.equal(g.replies.at(-1)!.error?.uncertain, false); assert.equal(controller.getSnapshot().uncertainRequest, false);
  assert.equal(controller.getSnapshot().error?.code, 'preview-expired');
  controller.dismissPreview(); await controller.preview('trash', [group.sessionId]); await controller.confirm();
  assert.equal(controller.getSnapshot().result?.items[0]?.status, 'moved');
  const requests = g.requests.filter(request => request.action === 'execute'); assert.equal(requests.length, 3);
  assert.equal(requests[0]!.requestId, requests[1]!.requestId); assert.notEqual(requests[0]!.requestId, requests[2]!.requestId);
});

test('a missing receipt is not proof of non-admission when an operation journal still names the request', async t => {
  const f = await fixture(); t.after(f.close); const group = await f.add('orphan-operation'); f.adapter.loaded.add(group.sessionId);
  const preview = await f.service.preview('trash', [group.sessionId]); const requestId = randomUUID();
  await f.service.execute(preview.id, requestId);
  await unlink(join(f.store.root, 'receipts', `${requestId}.json`));
  const g = gateway(f.service);
  await assert.rejects(g.client.execute(preview.id, requestId), ClientTransportError);
  assert.equal(g.replies.at(-1)!.error?.uncertain, true); assert.equal(g.replies.at(-1)!.error?.code, 'recovery-required');
  assert.equal((await f.store.operations()).length, 1); assert.equal(await present(group.members[0]!.directory), true);
});

test('legacy mutation failures are conservative while typed refusals and read errors stay compatible', async () => {
  const send = (error: unknown, status = 500) => createArchiveApi(async () => new Response(JSON.stringify({ ok: false, error }), { status }), 'https://example.test/');
  const generic = { code: 'operation-failed', message: 'The operation needs recovery.' };
  await assert.rejects(send(generic).execute('preview', randomUUID()), ClientTransportError);
  await assert.rejects(send(generic).cancelPending(['session'], randomUUID()), ClientTransportError);
  await assert.rejects(send(generic).installUpdate!('candidate', randomUUID()), ClientTransportError);
  await assert.rejects(send(generic).list(), error => error instanceof ArchiveError && error.code === 'operation-failed');
  await assert.rejects(send({ ...generic, uncertain: false }).execute('preview', randomUUID()), ArchiveError);
  await assert.rejects(send({ code: 'busy', message: 'Still held.' }, 409).execute('preview', randomUUID()), ArchiveError);
  await assert.rejects(send({ code: 'corrupt-state', message: 'Review recovery.', uncertain: true }, 409).execute('preview', randomUUID()), ClientTransportError);
  for (const uncertain of ['true', null, {}, 1]) await assert.rejects(send({ ...generic, uncertain }).execute('preview', randomUUID()), ClientTransportError);
});
