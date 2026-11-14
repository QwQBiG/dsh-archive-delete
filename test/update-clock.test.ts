import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { UpdateService } from '../src/update-service.js';
import { UpdateRateLimitError } from '../src/update-source-types.js';
import { ArchiveError } from '../src/contracts.js';

async function fixture(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'archive-update-clock-')));
  let now = Date.UTC(2026, 10, 13); let checks = 0; let failure: Error | undefined; let wait: Promise<void> | undefined;
  const service = new UpdateService({ root, now: () => now,
    host: { profileId: 'clock-test', hostVersion: '0.2.1-rc.5', loadedVersion: '0.0.3', canInstall: true,
      installed: async () => ({ version: '0.0.3', source: 'synthetic' }), install: async () => { throw Error('Unexpected install'); } },
    source: { check: async () => { checks++; await wait; if (failure) throw failure; return { availability: 'current' }; },
      revalidate: async () => { throw Error('Unexpected revalidation'); }, download: async () => { throw Error('Unexpected download'); } },
    beginUpdate: async () => { throw Error('Unexpected archive admission'); } });
  t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }); });
  await service.initialize();
  return { service, get now() { return now; }, set now(value: number) { now = value; }, get checks() { return checks; },
    set failure(value: Error | undefined) { failure = value; }, set wait(value: Promise<void> | undefined) { wait = value; } };
}

for (const force of [false, true]) test(`a live clock rollback refreshes discovery with force=${force}`, async t => {
  const f = await fixture(t); await f.service.info(); assert.equal(f.checks, 1);
  f.now -= 2 * 24 * 60 * 60_000;
  const refreshed = await f.service.info(force);
  assert.equal(f.checks, 2, 'the prior future checkedAt must not block discovery');
  assert.equal(refreshed.checkedAt, f.now);
  await Promise.all([f.service.info(), f.service.info(true)]);
  assert.equal(f.checks, 2, 'the refreshed observation restores the normal one-minute manual limit');
});

test('clock rollback does not bypass an explicit GitHub retry deadline', async t => {
  const f = await fixture(t); const retryAt = f.now + 2 * 60 * 60_000;
  f.failure = new UpdateRateLimitError(retryAt);
  await f.service.info(); assert.equal(f.checks, 1);
  f.now -= 60_000;
  await f.service.info(true); await f.service.info();
  assert.equal(f.checks, 1); assert.equal((await f.service.info()).nextCheckAt, retryAt);
  f.now = retryAt; await f.service.info(); assert.equal(f.checks, 2);
});

test('concurrent checks share a deferred rollback refresh and retain the exact manual throttle boundary', async t => {
  const f = await fixture(t); await f.service.info(); f.now -= 60 * 60_000;
  let finish!: () => void; f.wait = new Promise<void>(resolve => { finish = resolve; });
  const reads = [f.service.info(), f.service.info(true), f.service.info(), f.service.info(true)];
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.checks, 2, 'only one fresh source check runs while discovery is deferred');
  } finally { finish(); }
  for (const info of await Promise.all(reads)) assert.equal(info.checkedAt, f.now);
  f.wait = undefined; f.now += 59_999; await f.service.info(true); assert.equal(f.checks, 2);
  f.now++; await f.service.info(true); assert.equal(f.checks, 3, 'manual checks resume exactly one minute after the new observation');
});

test('a non-rate-limit error cache also refreshes after the clock moves backward', async t => {
  const f = await fixture(t); f.failure = new ArchiveError('update-network', 'Synthetic network failure');
  assert.equal((await f.service.info()).availability, 'error'); assert.equal(f.checks, 1);
  f.failure = undefined; f.now -= 60_000;
  const current = await f.service.info(); assert.equal(current.availability, 'current'); assert.equal(current.checkedAt, f.now);
  assert.equal(f.checks, 2); assert.equal(current.code, undefined);
});
