import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { ArchiveError, SUPPORTED_DSH_VERSION } from '../src/contracts.js';
import { UpdateService } from '../src/update-service.js';
import type { HostUpdateResult, UpdateHost } from '../src/update-host-types.js';
import type { ReleaseCheck, UpdateSource } from '../src/update-source-types.js';
import { UpdateRateLimitError } from '../src/update-source-types.js';

const DAY = 86_400_000;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function fixture(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'archive-update-service-')));
  const bytes = Buffer.from('Synthetic bytes already verified by the fake release source.');
  const digest = createHash('sha256').update(bytes).digest('hex');
  const candidate = { id: 'verified-candidate', version: '0.1.9', requiredDshVersion: SUPPORTED_DSH_VERSION,
    publishedAt: '2026-10-29T00:00:00Z', releaseUrl: 'https://github.com/QwQBiG/dsh-archive-delete/releases/tag/v0.1.9', notes: 'Synthetic release', assetBytes: bytes.length };
  const pin = { candidate, assetUrl: 'https://github.com/QwQBiG/dsh-archive-delete/releases/download/v0.1.9/package.tgz', sha256: digest };
  const calls = { checks: 0, reads: 0, revalidates: 0, downloads: 0, installs: [] as { path: string; version: string; requestId: string }[], releases: [] as boolean[], begins: 0 };
  const state: { now: number; installed: string; check?: (signal?: AbortSignal) => Promise<ReleaseCheck>;
    revalidate?: UpdateSource['revalidate']; download?: UpdateSource['download'];
    install?: UpdateHost['install']; begin?: () => Promise<(restart?: boolean) => void> } = { now: Date.UTC(2026, 9, 29), installed: '0.1.0' };
  const source: UpdateSource = {
    check: async signal => { calls.checks++; return state.check ? state.check(signal) : { availability: 'available', candidate, pinned: pin }; },
    revalidate: async checked => { calls.revalidates++; if (state.revalidate) await state.revalidate(checked); },
    download: async (checked, signal) => { calls.downloads++; return state.download ? state.download(checked, signal) : bytes; },
  };
  const host: UpdateHost = { profileId: 'synthetic-desktop', loadedVersion: '0.1.0', hostVersion: SUPPORTED_DSH_VERSION, canInstall: true,
    installed: async () => { calls.reads++; return { version: state.installed, source: 'synthetic-current-source' }; },
    install: async (path, version, requestId) => { calls.installs.push({ path, version, requestId });
      if (state.install) return state.install(path, version, requestId); state.installed = version; return { status: 'restart-required' }; } };
  const services: UpdateService[] = [];
  const create = () => {
    const service = new UpdateService({ root, host, source, now: () => state.now, beginUpdate: async () => {
      calls.begins++; return state.begin ? state.begin() : restart => { calls.releases.push(restart === true); };
    } }); services.push(service); return service;
  };
  t.after(async () => { for (const service of services) await service.close(); await rm(root, { recursive: true, force: true }); });
  const service = create(); await service.initialize();
  return { root, bytes, digest, candidate, pin, calls, state, source, host, service, create,
    packagePath: join(root, 'updates', 'packages', `${candidate.version}-${digest}.tgz`) };
}

test('discovery caches one day, coalesces reads, and manual checks are limited to once a minute', async t => {
  const f = await fixture(t);
  const available = await f.service.info(); assert.equal(available.availability, 'available'); assert.equal(f.calls.checks, 1);
  await Promise.all([f.service.info(), f.service.info(true), f.service.info(true)]); assert.equal(f.calls.checks, 1);
  f.state.now += 59_999; await f.service.info(true); assert.equal(f.calls.checks, 1);
  f.state.now++; await Promise.all([f.service.info(true), f.service.info(true)]); assert.equal(f.calls.checks, 2);
  f.state.now += DAY - 1; await f.service.info(); assert.equal(f.calls.checks, 2);
  f.state.now++; await f.service.info(); assert.equal(f.calls.checks, 3);
  assert.equal(f.calls.installs.length, 0); assert.equal(f.calls.downloads, 0); assert.equal(f.calls.begins, 0);
});

test('profiles retain separate discovery and installation journals in a shared plugin home', async t => {
  const f = await fixture(t); await f.service.info();
  const requestId = randomUUID(); await f.service.install(f.candidate.id, requestId); await f.service.close();
  const desktopFile = join(f.root, 'updates', `${createHash('sha256').update(f.host.profileId).digest('hex')}.installation.json`);
  const before = await readFile(desktopFile);
  f.host.profileId = 'synthetic-web'; f.state.installed = f.host.loadedVersion;
  const other = f.create(); await other.initialize();
  const info = await other.info(); assert.equal(info.installation, undefined);
  assert.equal(f.calls.checks, 3, 'the other profile does not inherit the first profile discovery cache');
  assert.deepEqual(await readFile(desktopFile), before);
  const serialized = JSON.stringify(info); assert.equal(serialized.includes('synthetic-web'), false);
});

test('restart reuses persisted check metadata, and network errors never report current or discard an old candidate', async t => {
  const f = await fixture(t); await f.service.info(); await f.service.close();
  const restarted = f.create(); await restarted.initialize();
  assert.equal((await restarted.info()).availability, 'available'); assert.equal(f.calls.checks, 1);
  f.state.now += 60_000; f.state.check = async () => { throw new ArchiveError('update-network', 'Synthetic network failure'); };
  const failed = await restarted.info(true); assert.equal(failed.availability, 'error'); assert.equal(failed.code, 'update-network');
  assert.equal(failed.candidate?.id, f.candidate.id); assert.equal(failed.nextCheckAt, f.state.now + 3_600_000);
  await restarted.close(); const next = f.create(); await next.initialize();
  assert.equal((await next.info()).availability, 'error'); assert.equal(f.calls.checks, 2);
  const cache = await readFile(join(f.root, 'updates', `${createHash('sha256').update(f.host.profileId).digest('hex')}.check.json`), 'utf8');
  assert.equal(cache.includes(f.pin.assetUrl), false); assert.equal(cache.includes(f.pin.sha256), false);
});

test('only a matching explicit confirmation with a fresh unchanged release reaches the native manager', async t => {
  const f = await fixture(t); await f.service.info();
  await assert.rejects(() => f.service.install('unreviewed', randomUUID()), { code: 'update-changed' });
  assert.equal(f.calls.installs.length, 0);
  f.state.check = async () => ({ availability: 'available', candidate: { ...f.candidate, id: 'new-release' }, pinned: { ...f.pin, candidate: { ...f.candidate, id: 'new-release' } } });
  await assert.rejects(() => f.service.install(f.candidate.id, randomUUID()), { code: 'update-changed' });
  assert.equal(f.calls.downloads, 0); assert.equal(f.calls.installs.length, 0);
  delete f.state.check; f.state.revalidate = async () => { throw new ArchiveError('update-changed', 'Pin changed'); };
  await assert.rejects(() => f.service.install(f.candidate.id, randomUUID()), { code: 'update-changed' });
  assert.equal(f.calls.downloads, 0); assert.equal(f.calls.begins, 0);
});

test('verified package bytes are retained at a digest path and same-request retries never run a second install', async t => {
  const f = await fixture(t); await f.service.info(); const requestId = randomUUID();
  const result = await f.service.install(f.candidate.id, requestId);
  assert.equal(result.installation?.status, 'restart-required'); assert.equal(result.installedVersion, f.candidate.version);
  assert.deepEqual(await readFile(f.packagePath), f.bytes); assert.equal(f.calls.installs[0]?.path, f.packagePath);
  assert.deepEqual(f.calls.releases, [true]);
  await f.service.install(f.candidate.id, requestId); assert.equal(f.calls.installs.length, 1); assert.equal(f.calls.downloads, 1);
  await assert.rejects(() => f.service.install('another-candidate', requestId), { code: 'update-request-conflict' });
  await assert.rejects(() => f.service.install(f.candidate.id, randomUUID()), { code: 'update-in-progress' });
  const journal = JSON.parse(await readFile(join(f.root, 'updates', `${createHash('sha256').update(f.host.profileId).digest('hex')}.installation.json`), 'utf8'));
  assert.equal(journal.requestId, requestId); assert.equal(journal.status, 'restart-required');
});

test('parallel confirmation IDs coalesce by request while a different request is refused synchronously', async t => {
  const f = await fixture(t); await f.service.info(); const barrier = deferred<Uint8Array>(); const entered = deferred<void>();
  f.state.download = async () => { entered.resolve(); return barrier.promise; };
  const id = randomUUID(); const first = f.service.install(f.candidate.id, id); await entered.promise;
  const duplicate = f.service.install(f.candidate.id, id);
  await assert.rejects(() => f.service.install(f.candidate.id, randomUUID()), { code: 'update-in-progress' });
  assert.equal(f.calls.downloads, 1); assert.equal(f.calls.installs.length, 0);
  barrier.resolve(f.bytes); assert.deepEqual(await first, await duplicate); assert.equal(f.calls.installs.length, 1);
});

test('the archive drain completes before the native manager is called, and pre-delegation close releases the gate', async t => {
  const f = await fixture(t); await f.service.info(); const barrier = deferred<(restart?: boolean) => void>(); const entered = deferred<void>();
  f.state.begin = async () => { entered.resolve(); return barrier.promise; };
  const installing = f.service.install(f.candidate.id, randomUUID()); const rejection = assert.rejects(() => installing, { code: 'update-stopping' });
  await entered.promise; assert.equal(f.calls.installs.length, 0);
  await f.service.close(); barrier.resolve(restart => { f.calls.releases.push(restart === true); });
  await rejection; assert.equal(f.calls.installs.length, 0); assert.deepEqual(f.calls.releases, [false]);
});

test('closing during a host-owned install settles immediately and does not abort or await that manager job', async t => {
  const f = await fixture(t); await f.service.info(); const barrier = deferred<HostUpdateResult>(); const entered = deferred<void>();
  f.state.install = async () => { entered.resolve(); const result = await barrier.promise; f.state.installed = f.candidate.version; return result; };
  const task = f.service.install(f.candidate.id, randomUUID()); await entered.promise;
  await f.service.close(); assert.equal(f.calls.installs.length, 1); assert.deepEqual(f.calls.releases, []);
  barrier.resolve({ status: 'restart-required' }); const result = await task;
  assert.equal(result.installation?.status, 'restart-required'); assert.deepEqual(f.calls.releases, [true]);
  assert.deepEqual(await readFile(f.packagePath), f.bytes);
});

test('closing while pre-delegation journal writes are pending does not start a native installation', async t => {
  const f = await fixture(t); await f.service.info(); const closed = deferred<void>();
  f.state.begin = async () => {
    setImmediate(() => { void f.service.close().then(() => closed.resolve()); });
    return restart => { f.calls.releases.push(restart === true); };
  };
  await assert.rejects(() => f.service.install(f.candidate.id, randomUUID()), { code: 'update-stopping' });
  await closed.promise; assert.equal(f.calls.installs.length, 0); assert.deepEqual(f.calls.releases, [false]);
  const saved = JSON.parse(await readFile(join(f.root, 'updates', `${createHash('sha256').update(f.host.profileId).digest('hex')}.installation.json`), 'utf8'));
  assert.equal(saved.status, 'failed');
});

test('metadata-only checks are cancelled and joined when the service closes', async t => {
  const f = await fixture(t); const entered = deferred<void>(); let signal: AbortSignal | undefined;
  f.state.check = async requestSignal => { signal = requestSignal; entered.resolve();
    await new Promise<void>(resolve => requestSignal!.addEventListener('abort', () => resolve(), { once: true }));
    throw new ArchiveError('update-network', 'Aborted'); };
  const check = f.service.info(); await entered.promise; await f.service.close();
  assert.equal(signal?.aborted, true); assert.equal((await check).canInstall, false); assert.equal(f.calls.installs.length, 0);
});

test('a definite failed native install preserves the package and permits a new confirmation, while an unknown result protects the archive', async t => {
  const f = await fixture(t); await f.service.info();
  f.state.install = async () => ({ status: 'failed', code: 'update-install-failed' });
  const failed = await f.service.install(f.candidate.id, randomUUID()); assert.equal(failed.installation?.status, 'failed'); assert.deepEqual(f.calls.releases, [false]);
  assert.deepEqual(await readFile(f.packagePath), f.bytes);
  f.state.install = async () => ({ status: 'unknown', code: 'update-install-unknown' });
  const unknown = await f.service.install(f.candidate.id, randomUUID()); assert.equal(unknown.installation?.status, 'unknown');
  assert.deepEqual(f.calls.releases, [false, true]); assert.equal(f.calls.installs.length, 2);
  await assert.rejects(() => f.service.install(f.candidate.id, randomUUID()), { code: 'update-in-progress' });
});

test('startup reconciles interrupted, pending-restart and installed receipts against actual disk and loaded versions', async t => {
  for (const scenario of ['old-disk', 'new-disk-old-code', 'new-code', 'stale-installed'] as const) {
    const f = await fixture(t);
    await writeFile(join(f.root, 'updates', `${createHash('sha256').update(f.host.profileId).digest('hex')}.installation.json`), JSON.stringify({ requestId: randomUUID(), candidateId: f.candidate.id,
      version: f.candidate.version, status: scenario === 'stale-installed' ? 'installed' : 'unknown', code: 'update-install-unknown', startedAt: f.state.now }));
    if (scenario === 'new-disk-old-code' || scenario === 'new-code') f.state.installed = f.candidate.version;
    if (scenario === 'new-code') f.host.loadedVersion = f.candidate.version;
    const restarted = f.create(); await restarted.initialize();
    const result = await restarted.info();
    assert.equal(result.installation?.status, scenario === 'old-disk' || scenario === 'stale-installed' ? 'interrupted'
      : scenario === 'new-code' ? 'installed' : 'restart-required');
    assert.deepEqual(f.calls.releases, scenario === 'new-disk-old-code' ? [true] : []);
    if (scenario === 'new-code') assert.equal(result.installation?.code, undefined, 'a reconciled success must clear the old uncertainty diagnostic');
  }
});

test('checksum mismatch, pre-existing inconsistent bytes and linked package paths fail before archive admission', async t => {
  for (const scenario of ['download', 'existing', 'symlink'] as const) {
    const f = await fixture(t); await f.service.info();
    if (scenario === 'download') f.state.download = async () => Buffer.from('bad bytes');
    if (scenario === 'existing') await writeFile(f.packagePath, Buffer.alloc(f.bytes.length, 42));
    if (scenario === 'symlink') {
      const outside = join(f.root, 'outside'); await writeFile(outside, f.bytes);
      try { await symlink(outside, f.packagePath, 'file'); }
      catch (error) { if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') continue; throw error; }
    }
    await assert.rejects(() => f.service.install(f.candidate.id, randomUUID())); assert.equal(f.calls.installs.length, 0); assert.equal(f.calls.begins, 0);
    if (scenario === 'existing') assert.deepEqual(await readFile(f.packagePath), Buffer.alloc(f.bytes.length, 42));
    if (scenario === 'symlink') assert.deepEqual(await readFile(join(f.root, 'outside')), f.bytes);
  }
});

test('linked update directories and linked persisted metadata are rejected without changing their target', async t => {
  for (const scenario of ['directory', 'metadata'] as const) {
    const f = await fixture(t); await f.service.close();
    const outside = join(f.root, 'outside'); await mkdir(outside);
    if (scenario === 'directory') {
      await rm(join(f.root, 'updates'), { recursive: true });
      await symlink(outside, join(f.root, 'updates'), process.platform === 'win32' ? 'junction' : 'dir');
    } else {
      const target = join(outside, 'check.json'); await writeFile(target, '{"retained":true}');
      try { await symlink(target, join(f.root, 'updates', `${createHash('sha256').update(f.host.profileId).digest('hex')}.check.json`), 'file'); }
      catch (error) { if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') continue; throw error; }
    }
    await assert.rejects(() => f.create().initialize());
    if (scenario === 'directory') assert.deepEqual(await readdir(outside), []);
    else assert.equal(await readFile(join(outside, 'check.json'), 'utf8'), '{"retained":true}');
  }
});

test('same-request retry actively reconciles native disk state without replaying an uncertain install', async t => {
  const f = await fixture(t); await f.service.info(); const requestId = randomUUID();
  f.state.install = async () => ({ status: 'unknown', code: 'update-install-unknown' });
  assert.equal((await f.service.install(f.candidate.id, requestId)).installation?.status, 'unknown');
  const reads = f.calls.reads;
  assert.equal((await f.service.install(f.candidate.id, requestId)).installation?.status, 'unknown');
  assert.ok(f.calls.reads > reads, 'a repeated confirmation performs a fresh native status read');
  assert.equal(f.calls.installs.length, 1);
  f.state.installed = f.candidate.version;
  const reconciled = await f.service.install(f.candidate.id, requestId);
  assert.equal(reconciled.installation?.status, 'restart-required'); assert.equal(reconciled.installation?.code, undefined);
  assert.equal(f.calls.installs.length, 1); assert.equal(f.calls.downloads, 1);
  assert.equal((await f.service.info()).installation?.status, 'restart-required');
});

test('installation status checks discover a completed target after an initially unknown native reply', async t => {
  const f = await fixture(t); await f.service.info(); f.state.install = async () => ({ status: 'unknown' });
  await f.service.install(f.candidate.id, randomUUID()); f.state.installed = f.candidate.version;
  assert.equal((await f.service.info(true)).installation?.status, 'restart-required');
  assert.equal(f.calls.installs.length, 1); assert.equal(f.calls.checks, 2, 'reconciliation does not contact GitHub');
});

test('GitHub backoff survives restart and manual checks cannot bypass Retry-After', async t => {
  const f = await fixture(t); const retryAt = f.state.now + 2 * DAY;
  f.state.check = async () => { throw new UpdateRateLimitError(retryAt); };
  assert.equal((await f.service.info()).nextCheckAt, retryAt);
  f.state.now += 60_000; await f.service.info(true); assert.equal(f.calls.checks, 1);
  await f.service.close(); const next = f.create(); await next.initialize(); await next.info(true); assert.equal(f.calls.checks, 1);
  f.state.now = retryAt; await next.info(); assert.equal(f.calls.checks, 2);
});

test('closing aborts installation preflight but never starts or replays a native job', async t => {
  const f = await fixture(t); await f.service.info(); const entered = deferred<void>(); let signal: AbortSignal | undefined;
  f.state.check = async requestSignal => {
    signal = requestSignal; entered.resolve();
    await new Promise<void>(resolve => requestSignal!.addEventListener('abort', () => resolve(), { once: true }));
    throw new ArchiveError('update-cancelled', 'Synthetic cancellation');
  };
  const installing = f.service.install(f.candidate.id, randomUUID());
  const rejected = assert.rejects(installing, { code: 'update-cancelled' });
  await entered.promise; await f.service.close(); await rejected;
  assert.equal(signal?.aborted, true); assert.equal(f.calls.installs.length, 0); assert.equal(f.calls.begins, 0);
});
