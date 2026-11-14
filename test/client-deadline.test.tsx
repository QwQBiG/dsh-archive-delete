import assert from 'node:assert/strict';
import test from 'node:test';
import { ArchiveClientController, ClientTransportError } from '../src/client-state.js';
import { createArchiveApi } from '../src/client.js';
import type { BatchResult, Overview, Preview, StorageOverview } from '../src/contracts.js';

const baseUri = 'https://example.test/';
const overview: Overview = { support: { supported: true, version: '0.2.1-rc.5', platform: 'darwin' },
  archived: [{ id: 'synthetic-session', title: 'Synthetic', workspace: 'QA', sizeBytes: 1, descendantCount: 0 }], trash: [], recentResults: [] };
const preview: Preview = { id: 'synthetic-preview', action: 'trash', expiresAt: Date.now() + 60_000,
  items: [{ id: 'synthetic-session', title: 'Synthetic', sessionId: 'synthetic-session', memberIds: ['synthetic-session'], sizeBytes: 1, disposition: 'ready' }] };
const storage: StorageOverview = { metric: 'logical-file-bytes', scope: 'host', workspaces: [], startedAt: 1, finishedAt: 2, durationMs: 1,
  complete: true, fileBytes: 0, referencedBytes: 0, fileCount: 0, uniqueFileCount: 0, duplicateHardlinks: 0, duplicatePaths: 0, identityUnknown: 0, categories: [] };
function reply(value: unknown): Response { return new Response(JSON.stringify({ ok: true, value })); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
async function flush(): Promise<void> { await new Promise(resolve => setImmediate(resolve)); }
function observe<T>(promise: Promise<T>) {
  const state: { status: 'pending' | 'fulfilled' | 'rejected'; value?: T; error?: unknown } = { status: 'pending' };
  void promise.then(value => { state.status = 'fulfilled'; state.value = value; }, error => { state.status = 'rejected'; state.error = error; });
  return state;
}

test('a gateway deadline releases a stalled header wait even when transport ignores abort', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = deferred<Response>(); let signal: AbortSignal | undefined;
  const api = createArchiveApi(async (_url, init) => { signal = init?.signal ?? undefined; return pending.promise; }, baseUri, { timeoutMs: 1_000 });
  const received = observe(api.list());
  t.mock.timers.tick(999); await flush(); assert.equal(received.status, 'pending');
  t.mock.timers.tick(1); await flush();
  assert.equal(received.status, 'rejected'); assert.ok(received.error instanceof ClientTransportError);
  assert.equal(signal?.aborted, true);
  pending.resolve(reply(overview)); await flush(); assert.equal(received.status, 'rejected', 'a late response cannot replace the timeout');
});

test('the same total deadline covers headers and an unfinished response body', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = deferred<Response>(); let body!: ReadableStreamDefaultController<Uint8Array>;
  const api = createArchiveApi(async () => pending.promise, baseUri, { timeoutMs: 1_000 });
  const received = observe(api.list());
  t.mock.timers.tick(600); pending.resolve(new Response(new ReadableStream<Uint8Array>({ start(controller) { body = controller; } }))); await flush();
  t.mock.timers.tick(399); await flush(); assert.equal(received.status, 'pending');
  t.mock.timers.tick(1); await flush();
  assert.equal(received.status, 'rejected'); assert.ok(received.error instanceof ClientTransportError);
  body.enqueue(new TextEncoder().encode(JSON.stringify({ ok: true, value: overview }))); body.close(); await flush();
  assert.equal(received.status, 'rejected');
});

test('a timed-out mutation becomes uncertain and retries the exact preview and request IDs', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const requests: Array<{ previewId: string; requestId: string }> = []; const late = deferred<Response>();
  const transport: typeof fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    if (request.action === 'list') return reply(overview);
    if (request.action === 'preview') return reply(preview);
    if (request.action !== 'execute') throw new Error('Unexpected test request.');
    requests.push({ previewId: request.previewId, requestId: request.requestId });
    if (requests.length === 1) return late.promise;
    const result: BatchResult = { operationId: request.requestId, action: 'trash', counts: { succeeded: 1, pending: 0, skipped: 0, failed: 0 },
      items: [{ id: 'synthetic-session', title: '', status: 'moved' }] };
    return reply(result);
  };
  const controller = new ArchiveClientController(createArchiveApi(transport, baseUri, { timeoutMs: 1_000 }), () => 'same-request', () => 1);
  t.after(() => controller.dispose());
  await controller.open('synthetic-session'); const confirmation = controller.confirm();
  assert.equal(controller.getSnapshot().busy, true);
  controller.close(); await controller.open(); assert.equal(controller.getSnapshot().busy, true);
  t.mock.timers.tick(1_000); await flush();
  assert.equal(controller.getSnapshot().busy, false); assert.equal(controller.getSnapshot().uncertainRequest, true);
  await confirmation; await controller.retryUncertain();
  assert.deepEqual(requests, [{ previewId: 'synthetic-preview', requestId: 'same-request' }, { previewId: 'synthetic-preview', requestId: 'same-request' }]);
  assert.equal(controller.getSnapshot().result?.items[0]?.status, 'moved'); assert.equal(controller.getSnapshot().uncertainRequest, false);
  const settled = controller.getSnapshot(); late.resolve(reply({ invalid: 'late reply' })); await flush(); assert.equal(controller.getSnapshot(), settled);
});

test('a stalled list stops loading after the deadline without creating mutation uncertainty', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new ArchiveClientController(createArchiveApi(async () => new Promise<Response>(() => {}), baseUri, { timeoutMs: 1_000 }));
  t.after(() => controller.dispose()); const opening = controller.open();
  t.mock.timers.tick(1_000); await flush();
  assert.equal(controller.getSnapshot().loading, false); assert.equal(controller.getSnapshot().error?.code, 'list-failed');
  assert.equal(controller.getSnapshot().uncertainRequest, false); await opening;
});

test('explicit storage cancellation retains its reason and does not wait for the deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); let transportSignal: AbortSignal | undefined;
  const api = createArchiveApi(async (_url, init) => { transportSignal = init?.signal ?? undefined; return new Promise<Response>(() => {}); }, baseUri, { timeoutMs: 1_000 });
  const abort = new AbortController(); const reason = new DOMException('Cancelled by user', 'AbortError');
  const received = observe(api.storage!(undefined, abort.signal)); abort.abort(reason); await flush();
  assert.equal(received.status, 'rejected'); assert.equal(received.error, reason); assert.equal(transportSignal?.aborted, true);
  t.mock.timers.tick(1_000); await flush(); assert.equal(received.error, reason);
});

test('an already-cancelled scan does not call transport', async () => {
  const abort = new AbortController(); const reason = new DOMException('Already cancelled', 'AbortError'); abort.abort(reason); let calls = 0;
  const api = createArchiveApi(async () => { calls++; return reply({}); }, baseUri, { timeoutMs: 1_000 });
  await assert.rejects(api.storage!(undefined, abort.signal), error => error === reason); assert.equal(calls, 0);
});

test('a completed request clears its timer and removes its cancellation listener', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); let signal: AbortSignal | undefined;
  const abort = new AbortController(); let removed = 0;
  const remove = abort.signal.removeEventListener.bind(abort.signal);
  abort.signal.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => {
    removed++; remove(type, listener, options);
  };
  const api = createArchiveApi(async (_url, init) => { signal = init?.signal ?? undefined; return reply(storage); }, baseUri, { timeoutMs: 1_000 });
  assert.deepEqual(await api.storage!(undefined, abort.signal), storage);
  assert.equal(removed, 1); t.mock.timers.tick(1_000); assert.equal(signal?.aborted, false);
});

test('the default budget allows a slow reply for up to one minute', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); const pending = deferred<Response>();
  const received = observe(createArchiveApi(async () => pending.promise, baseUri).list());
  t.mock.timers.tick(59_999); await flush(); assert.equal(received.status, 'pending');
  t.mock.timers.tick(1); await flush(); assert.equal(received.status, 'rejected'); assert.ok(received.error instanceof ClientTransportError);
});

test('invalid deadline values are rejected before starting a request', () => {
  for (const timeoutMs of [0, -1, 1.5, NaN, Infinity, 2_147_483_648]) {
    assert.throws(() => createArchiveApi(async () => reply(overview), baseUri, { timeoutMs }), RangeError);
  }
});
