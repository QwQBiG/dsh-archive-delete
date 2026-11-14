import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { UpdateService } from '../src/update-service.js';
import type { HostUpdateResult } from '../src/update-host-types.js';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

async function fixture(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'archive-update-replay-')));
  const bytes = Buffer.from('Synthetic verified package bytes');
  const candidate = { id: 'same-release', version: '0.0.4', requiredDshVersion: '0.2.1-rc.5', publishedAt: '2026-11-13T00:00:00Z',
    releaseUrl: 'https://github.com/QwQBiG/dsh-archive-delete/releases/tag/v0.0.4', notes: 'Synthetic release', assetBytes: bytes.length };
  const pinned = { candidate, assetUrl: 'https://github.com/QwQBiG/dsh-archive-delete/releases/download/v0.0.4/synthetic.tgz', sha256: createHash('sha256').update(bytes).digest('hex') };
  const installs: string[] = []; const services: UpdateService[] = []; const releases: boolean[] = [];
  const state: { install?: (requestId: string) => Promise<HostUpdateResult>; begin?: () => Promise<void>; checks: number } = { checks: 0 };
  const profileKey = (profileId = 'replay-test') => createHash('sha256').update(profileId).digest('hex');
  const latestPath = (profileId?: string) => join(root, 'updates', `${profileKey(profileId)}.installation.json`);
  const requestPath = (requestId: string, profileId?: string) => join(root, 'updates', `${profileKey(profileId)}.${requestId}.request.json`);
  const receipt = (requestId: string, status: string) => ({ requestId, candidateId: candidate.id, version: candidate.version, startedAt: Date.now(), status,
    ...(status === 'failed' ? { code: 'update-install-failed' } : {}) });
  const create = async (profileId = 'replay-test') => {
    const service = new UpdateService({ root,
      host: { profileId, hostVersion: '0.2.1-rc.5', loadedVersion: '0.0.3', canInstall: true,
        installed: async () => ({ version: '0.0.3', source: 'synthetic' }), install: async (_path, _version, requestId) => {
          installs.push(requestId); return state.install ? state.install(requestId) : { status: 'failed', code: 'update-install-failed' };
        } },
      source: { check: async () => { state.checks++; return { availability: 'available', candidate, pinned }; }, revalidate: async () => {}, download: async () => bytes },
      beginUpdate: async () => { await state.begin?.(); return restart => { releases.push(restart === true); }; } });
    services.push(service); await service.initialize(); await service.info(); return service;
  };
  t.after(async () => { for (const service of services) await service.close(); await rm(root, { recursive: true, force: true }); });
  return { root, candidate, installs, releases, state, create, latestPath, requestPath, receipt };
}

for (const restart of [false, true]) test(`a previous confirmed request is not delegated again after another failed request; restart=${restart}`, async t => {
  const f = await fixture(t); let service = await f.create(); const first = randomUUID(); const second = randomUUID();
  assert.equal((await service.install(f.candidate.id, first)).installation?.status, 'failed');
  assert.equal((await service.install(f.candidate.id, second)).installation?.status, 'failed');
  if (restart) { await service.close(); service = await f.create(); }
  const replay = await service.install(f.candidate.id, first);
  assert.deepEqual(f.installs, [first, second], 'checking the first recorded request must not run a third native install');
  assert.equal(replay.installation?.requestId, first);
  assert.equal(replay.installation?.status, 'failed');
});

test('an older request keeps its candidate binding after a later confirmation', async t => {
  const f = await fixture(t); const service = await f.create(); const first = randomUUID(); const second = randomUUID();
  await service.install(f.candidate.id, first); await service.install(f.candidate.id, second);
  await assert.rejects(service.install('different-release', first), { code: 'update-request-conflict' });
  assert.deepEqual(f.installs, [first, second]);
});

test('reading an older result leaves the latest-state record and GitHub checks unchanged', async t => {
  const f = await fixture(t); const service = await f.create(); const first = randomUUID(); const second = randomUUID();
  await service.install(f.candidate.id, first); await service.install(f.candidate.id, second);
  const before = await readFile(f.latestPath()); const checks = f.state.checks; const releases = [...f.releases];
  assert.equal((await service.install(f.candidate.id, first)).installation?.requestId, first);
  assert.deepEqual(await readFile(f.latestPath()), before);
  assert.equal((await service.info()).installation?.requestId, second);
  assert.equal(f.state.checks, checks); assert.deepEqual(f.releases, releases);
});

test('parallel first confirmations with the same ID still delegate only once', async t => {
  const f = await fixture(t); const service = await f.create(); const entered = deferred<void>(); const finish = deferred<HostUpdateResult>(); const id = randomUUID();
  f.state.install = async () => { entered.resolve(); return finish.promise; };
  const first = service.install(f.candidate.id, id); const second = service.install(f.candidate.id, id);
  await entered.promise; assert.deepEqual(f.installs, [id]);
  finish.resolve({ status: 'failed', code: 'update-install-failed' });
  assert.deepEqual(await first, await second); assert.deepEqual(f.installs, [id]);
});

test('an older terminal receipt cannot replace an in-progress newer installation', async t => {
  const f = await fixture(t); const service = await f.create(); const old = randomUUID(); const current = randomUUID();
  await service.install(f.candidate.id, old);
  const entered = deferred<void>(); const finish = deferred<HostUpdateResult>();
  f.state.install = async () => { entered.resolve(); return finish.promise; };
  const active = service.install(f.candidate.id, current); await entered.promise;
  await assert.rejects(service.install(f.candidate.id, old), { code: 'update-in-progress' });
  assert.equal((await service.info()).installation?.requestId, current);
  finish.resolve({ status: 'failed', code: 'update-install-failed' }); await active;
  assert.equal((await service.install(f.candidate.id, old)).installation?.requestId, old);
  assert.deepEqual(f.installs, [old, current]);
});

test('an older terminal receipt cannot clear a newer uncertain outcome', async t => {
  const f = await fixture(t); const service = await f.create(); const old = randomUUID(); const current = randomUUID();
  await service.install(f.candidate.id, old); f.state.install = async () => ({ status: 'unknown', code: 'update-install-unknown' });
  await service.install(f.candidate.id, current);
  await assert.rejects(service.install(f.candidate.id, old), { code: 'update-in-progress' });
  assert.equal((await service.info()).installation?.status, 'unknown'); assert.deepEqual(f.releases, [false, true]);
  assert.deepEqual(f.installs, [old, current]);
});

test('a legacy latest-only result is migrated before a new confirmation replaces it', async t => {
  const f = await fixture(t); const original = await f.create(); await original.close();
  const legacy = randomUUID(); const next = randomUUID(); await writeFile(f.latestPath(), JSON.stringify(f.receipt(legacy, 'failed')));
  const migrated = await f.create(); assert.equal((await migrated.info()).installation?.requestId, legacy);
  await migrated.install(f.candidate.id, next); await migrated.close();
  const restarted = await f.create();
  assert.equal((await restarted.install(f.candidate.id, legacy)).installation?.status, 'failed');
  assert.deepEqual(f.installs, [next]); assert.equal(JSON.parse(await readFile(f.requestPath(legacy), 'utf8')).requestId, legacy);
});

test('startup uses the durable request result when the latest-state update was interrupted', async t => {
  const f = await fixture(t); const original = await f.create(); await original.close(); const id = randomUUID();
  await writeFile(f.latestPath(), JSON.stringify(f.receipt(id, 'installing')));
  await writeFile(f.requestPath(id), JSON.stringify(f.receipt(id, 'failed')));
  const restarted = await f.create(); assert.equal((await restarted.info()).installation?.status, 'failed');
  assert.equal((await restarted.install(f.candidate.id, id)).installation?.status, 'failed'); assert.deepEqual(f.installs, []);
});

test('an intent interrupted before latest-state publication keeps its UUID consumed', async t => {
  const f = await fixture(t); const service = await f.create(); const id = randomUUID();
  await writeFile(f.requestPath(id), JSON.stringify(f.receipt(id, 'installing')));
  assert.equal((await service.install(f.candidate.id, id)).installation?.status, 'interrupted');
  assert.equal((await service.info()).installation, undefined, 'replaying an orphan must not publish it as the latest installation');
  await service.close(); const restarted = await f.create();
  assert.equal((await restarted.install(f.candidate.id, id)).installation?.status, 'interrupted'); assert.deepEqual(f.installs, []);
});

test('request receipt identity and regular-file checks reject substituted metadata before delegation', async t => {
  for (const invalid of ['identity', 'directory'] as const) {
    const f = await fixture(t); const service = await f.create(); const id = randomUUID();
    if (invalid === 'directory') await mkdir(f.requestPath(id));
    else await writeFile(f.requestPath(id), JSON.stringify(f.receipt(randomUUID(), 'failed')));
    await assert.rejects(service.install(f.candidate.id, id)); assert.deepEqual(f.installs, []);
  }
});

test('per-request records remain separate across profiles even when their UUIDs match', async t => {
  const f = await fixture(t); const first = await f.create(); const second = await f.create('other-profile'); const id = randomUUID();
  await first.install(f.candidate.id, id); await second.install(f.candidate.id, id);
  assert.deepEqual(f.installs, [id, id]);
  assert.equal((await first.install(f.candidate.id, id)).installation?.status, 'failed');
  assert.equal((await second.install(f.candidate.id, id)).installation?.status, 'failed'); assert.deepEqual(f.installs, [id, id]);
  assert.notEqual(f.requestPath(id), f.requestPath(id, 'other-profile'));
});

test('a completed request stays completed if publishing the latest-state copy fails', async t => {
  const f = await fixture(t); const service = await f.create(); const id = randomUUID(); let interruptedLatest: Buffer | undefined;
  f.state.install = async () => {
    interruptedLatest = await readFile(f.latestPath()); await rm(f.latestPath()); await mkdir(f.latestPath());
    return { status: 'failed', code: 'update-install-failed' };
  };
  const result = await service.install(f.candidate.id, id);
  assert.equal(result.installation?.status, 'failed'); assert.deepEqual(f.releases, [false]);
  assert.equal(JSON.parse(await readFile(f.requestPath(id), 'utf8')).status, 'failed');
  await rm(f.latestPath(), { recursive: true }); await writeFile(f.latestPath(), interruptedLatest!); await service.close();
  const restarted = await f.create(); assert.equal((await restarted.install(f.candidate.id, id)).installation?.status, 'failed');
  assert.deepEqual(f.installs, [id]);
});

test('a persistent latest-state obstruction before delegation preserves failure and releases the unchanged host', async t => {
  const f = await fixture(t); const service = await f.create(); const id = randomUUID();
  f.state.begin = async () => { await mkdir(f.latestPath()); };
  await assert.rejects(service.install(f.candidate.id, id), { code: 'update-state-unsafe' });
  assert.deepEqual(f.installs, []); assert.deepEqual(f.releases, [false]);
  assert.equal((await service.info()).installation?.status, 'failed');
  assert.equal(JSON.parse(await readFile(f.requestPath(id), 'utf8')).status, 'failed');
  await rm(f.latestPath(), { recursive: true }); delete f.state.begin; await service.close();
  const restarted = await f.create();
  assert.equal((await restarted.install(f.candidate.id, id)).installation?.status, 'failed'); assert.deepEqual(f.installs, []);
  const next = randomUUID(); await restarted.install(f.candidate.id, next);
  assert.deepEqual(f.installs, [next]); assert.deepEqual(f.releases, [false, false]);
});
