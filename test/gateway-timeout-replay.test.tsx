import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { ArchiveClientController } from '../src/client-state.js';
import { createArchiveApi } from '../src/client.js';
import { createRequestHandler } from '../src/host-routes.js';
import { RequestJournal } from '../src/request-journal.js';
import { fixture, present } from './fixtures.js';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }
async function flush() { await new Promise(resolve => setImmediate(resolve)); }

for (const action of ['execute', 'cancelPending'] as const) test(`gateway timeout: admitted ${action} completes and replays its original durable receipt`, async t => {
  const f = await fixture(); const resume = deferred(); let work: Promise<void> | undefined;
  t.after(async () => { resume.resolve(); await work; await f.close(); });
  const group = await f.add('one');
  const original = await readFile(join(group.members[0]!.directory, 'session.v4.jsonl'));
  if (action === 'cancelPending') {
    f.adapter.loaded.add('one'); const preview = await f.service.preview('trash', ['one']);
    await f.service.execute(preview.id, randomUUID());
  }
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const requestId = randomUUID(); const entered = deferred();
  const journal = (f.service as unknown as { requests: RequestJournal }).requests;
  const complete = journal.complete.bind(journal);
  journal.complete = async (id, interrupted) => {
    if (id === requestId) { entered.resolve(); await resume.promise; }
    return complete(id, interrupted);
  };
  const handler = createRequestHandler(f.service); const sent: { requestId: string; previewId?: string; ids?: string[] }[] = [];
  const transport: typeof fetch = async (input, init) => {
    const request = new Request(input, init); const body = JSON.parse(String(init?.body));
    if (body.action === action) sent.push({ requestId: body.requestId, ...(body.previewId ? { previewId: body.previewId } : { ids: body.ids }) });
    return handler(request);
  };
  const controller = new ArchiveClientController(createArchiveApi(transport, 'https://example.test/', { timeoutMs: 1_000 }), () => requestId);
  t.after(() => controller.dispose());
  await controller.open(action === 'execute' ? 'one' : undefined);
  work = action === 'execute' ? controller.confirm() : controller.cancelPending(['one']);
  await entered.promise; t.mock.timers.tick(1_000); await flush();
  assert.equal(controller.getSnapshot().uncertainRequest, true); assert.equal(controller.getSnapshot().busy, false);
  await work;
  resume.resolve(); await controller.retryUncertain();
  assert.equal(sent.length, 2); assert.deepEqual(sent[0], sent[1]);
  assert.equal(controller.getSnapshot().uncertainRequest, false);
  assert.equal(controller.getSnapshot().result?.items[0]!.status, action === 'execute' ? 'moved' : 'cancelled');
  assert.equal((await new RequestJournal(f.store.root).load(requestId))!.complete, true);
  if (action === 'execute') {
    const entries = await f.store.list(); assert.equal(entries.length, 1);
    assert.deepEqual(await readFile(join(f.store.root, 'trash', entries[0]!.id, '0', 'session.v4.jsonl')), original);
  } else {
    assert.equal(await present(group.members[0]!.directory), true);
    assert.deepEqual(await readFile(join(group.members[0]!.directory, 'session.v4.jsonl')), original);
  }
  assert.equal((await f.store.operations()).length, 0); assert.equal(f.adapter.locks, 0);
});
