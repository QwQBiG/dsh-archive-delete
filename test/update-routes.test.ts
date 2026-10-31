import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createRequestHandler, parseApiRequest } from '../src/host-routes.js';
import { fixture } from './fixtures.js';
import { ArchiveError, type ArchiveApi } from '../src/contracts.js';
import type { UpdateOverview } from '../src/update-contracts.js';

test('update routes accept only confirmation IDs and explicit check intent', async () => {
  const requestId = randomUUID();
  assert.deepEqual(parseApiRequest({ action: 'updates', force: false }), { action: 'updates', force: false });
  assert.deepEqual(parseApiRequest({ action: 'installUpdate', candidateId: 'pin', requestId }), { action: 'installUpdate', candidateId: 'pin', requestId });
  for (const bad of [{ action: 'updates' }, { action: 'updates', force: 'yes' },
    { action: 'updates', force: true, repository: 'attacker/other' },
    { action: 'installUpdate', candidateId: 'pin', requestId, url: 'https://evil.example/code.tgz' },
    { action: 'installUpdate', candidateId: 'pin', requestId, path: '/tmp/anything.tgz' },
    { action: 'installUpdate', candidateId: '\0', requestId }]) assert.throws(() => parseApiRequest(bad), { code: 'invalid-request' });
  const value: UpdateOverview = { currentVersion: '0.1.5', installedVersion: '0.1.5', hostVersion: '0.2.1-rc.3', availability: 'current', canInstall: true };
  const called: unknown[] = [];
  const api = { updates: async (force: boolean) => { called.push(force); return value; },
    installUpdate: async (id: string, request: string) => { called.push([id, request]); return value; } } as unknown as ArchiveApi;
  const handler = createRequestHandler(api);
  const send = (body: unknown) => handler(new Request('http://127.0.0.1/api/dsh-archive-delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  assert.equal((await send({ action: 'updates', force: false })).status, 200);
  assert.equal((await send({ action: 'installUpdate', candidateId: 'pin', requestId })).status, 200);
  assert.deepEqual(called, [false, ['pin', requestId]]);
});

test('archive maintenance drains earlier writes, refuses new work and can close without awaiting an installer', async t => {
  const f = await fixture(); t.after(f.close); await f.add('one');
  let entered!: () => void; const writing = new Promise<void>(resolve => { entered = resolve; });
  let unblock!: () => void; const blocker = new Promise<void>(resolve => { unblock = resolve; });
  const original = f.adapter.removeRegistry.bind(f.adapter);
  f.adapter.removeRegistry = async group => { entered(); await blocker; await original(group); };
  const preview = await f.service.preview('trash', ['one']);
  const move = f.service.execute(preview.id, randomUUID()); await writing;
  let admitted = false;
  const admission = f.service.beginUpdate().then(release => { admitted = true; return release; });
  await setImmediate(); assert.equal(admitted, false);
  unblock(); assert.equal((await move).counts.succeeded, 1);
  const release = await admission; assert.equal(admitted, true);
  await assert.rejects(f.service.preview('trash', ['one']), { code: 'update-in-progress' });
  release(false); assert.equal((await f.service.list()).trash.length, 1);
  const after = await f.service.beginUpdate(); after(true);
  await assert.rejects(f.service.list(), { code: 'update-restart-required' });
  await f.service.close();
});

test('empty and nul-bearing confirmation identifiers are rejected before reaching a service', async () => {
  const requestId = randomUUID();
  for (const invalid of ['', '\0', 'x'.repeat(101)]) for (const body of [
    { action: 'execute', previewId: invalid, requestId },
    { action: 'execute', previewId: 'preview', requestId: invalid },
    { action: 'cancelPending', ids: ['one'], requestId: invalid },
    { action: 'installUpdate', candidateId: 'candidate', requestId: invalid },
  ]) assert.throws(() => parseApiRequest(body), { code: 'invalid-request' });
});

test('HTTP failures distinguish unsupported features, missing targets, busy resources and conflicts', async () => {
  for (const [code, status] of [
    ['unsupported-host', 422], ['update-unavailable', 501], ['workspace-not-found', 404], ['session-missing', 404],
    ['store-busy', 423], ['scan-busy', 423], ['update-in-progress', 423], ['scan-closed', 503], ['source-changed', 409], ['operation-failed', 500],
  ] as const) {
    const api = { list: async () => { throw new ArchiveError(code, 'Diagnostic'); } } as unknown as ArchiveApi;
    const reply = await createRequestHandler(api)(new Request('http://127.0.0.1/api/dsh-archive-delete', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'list' }),
    }));
    assert.equal(reply.status, status, code);
    assert.equal((await reply.json()).error.code, code);
  }
});

test('unbounded streaming bodies are cancelled as soon as the 64 KiB limit is crossed', async () => {
  let chunks = 0; let cancelled = false; let calls = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { chunks++; controller.enqueue(new Uint8Array(8192)); if (chunks === 100) controller.close(); },
    cancel() { cancelled = true; },
  });
  const request = new Request('http://127.0.0.1/api/dsh-archive-delete', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: stream, duplex: 'half',
  } as RequestInit);
  const handler = createRequestHandler({ list: async () => { calls++; throw new Error('not reached'); } } as unknown as ArchiveApi);
  const reply = await handler(request);
  assert.equal(reply.status, 413);
  assert.equal((await reply.json()).error.code, 'request-too-large');
  assert.equal(cancelled, true); assert.ok(chunks <= 10, `consumed ${chunks} chunks`); assert.equal(calls, 0);
});

test('preview operations must be primitive enum strings and coercible arrays never reach the service', async () => {
  let calls = 0;
  const handler = createRequestHandler({ preview: async () => { calls++; throw new Error('must not execute'); } } as unknown as ArchiveApi);
  for (const operation of [['trash'], ['restore'], ['purge'], {}, 1, true, null]) {
    const input = { action: 'preview', operation, ids: ['one'] };
    assert.throws(() => parseApiRequest(input), { code: 'invalid-request' });
    const reply = await handler(new Request('http://127.0.0.1/api/dsh-archive-delete', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    }));
    assert.equal(reply.status, 400);
    assert.equal((await reply.json()).error.code, 'invalid-request');
  }
  assert.equal(calls, 0);
});
