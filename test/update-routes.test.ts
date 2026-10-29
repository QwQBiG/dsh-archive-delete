import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createRequestHandler, parseApiRequest } from '../src/host-routes.js';
import { fixture } from './fixtures.js';
import type { ArchiveApi } from '../src/contracts.js';
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
