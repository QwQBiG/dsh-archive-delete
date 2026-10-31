import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import { createGithubUpdateSource, supportedPackageDshVersions, validateUpdatePackage, type GithubUpdateSourceOptions } from '../src/update-source.js';
import type { ReleaseUpdateMetadata } from '../src/update-contracts.js';

const HOST = '0.2.1-rc.3'; const VERSION = '0.1.6';
const API = 'https://api.github.com/repos/QwQBiG/dsh-archive-delete/releases';
const WEB = 'https://github.com/QwQBiG/dsh-archive-delete/releases';
interface TarEntry { name: string; data?: string | Buffer; type?: string }
function tar(entries: TarEntry[], terminate = true): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const data = Buffer.from(entry.data ?? ''); const header = Buffer.alloc(512);
    header.write(entry.name, 0, 100); header.write('0000644\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116);
    header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124); header.write('00000000000\0', 136);
    header.fill(32, 148, 156); header.write(entry.type ?? '0', 156); header.write('ustar\0', 257); header.write('00', 263);
    const checksum = header.reduce((sum, value) => sum + value, 0);
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148);
    parts.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  if (terminate) parts.push(Buffer.alloc(1024)); return Buffer.concat(parts);
}
function manifest(version = VERSION): Record<string, any> {
  return { name: '@qwqbig/dsh-archive-delete', version, main: './lib/index.js', engines: { dsh: HOST },
    dsh: { manifestVersion: 1, bundle: { patch: './cordis.patch.yml' } },
    scripts: { build: 'dev build only', prepack: 'dev pack only' }, devDependencies: { typescript: '*' },
    peerDependencies: { react: '^18.3.1' }, peerDependenciesMeta: { react: { optional: true } } };
}
function entries(pkg = manifest()): TarEntry[] {
  return [{ name: 'package/package.json', data: JSON.stringify(pkg) }, { name: 'package/cordis.patch.yml', data: "- insert:\n    - id: archive-delete\n      name: '@qwqbig/dsh-archive-delete'\n" },
    { name: 'package/lib/index.js', data: 'export const apply = () => {};' }, { name: 'package/lib/client.js', data: 'export const startClient = () => {};' }];
}
function artifact(version = VERSION, id = 1, bytes = gzipSync(tar(entries(manifest(version))))) {
  const name = `qwqbig-dsh-archive-delete-${version}.tgz`; const metadataName = name.replace(/\.tgz$/, '.update.json');
  const info: ReleaseUpdateMetadata = { schema: 1, packageName: '@qwqbig/dsh-archive-delete', version, requiredDshVersion: HOST,
    platforms: ['darwin', 'win32'], asset: { name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } };
  const release = { id, draft: false, prerelease: false, tag_name: `v${version}`, published_at: '2026-10-29T00:00:00Z', html_url: `${WEB}/tag/v${version}`, body: 'Updates / 更新',
    assets: [{ id: id * 10 + 1, name, size: bytes.length, state: 'uploaded', browser_download_url: `${WEB}/download/v${version}/${name}` },
      { id: id * 10 + 2, name: metadataName, size: 0, state: 'uploaded', browser_download_url: `${WEB}/download/v${version}/${metadataName}` }] };
  const item = { bytes, info, release, metadataUrl: release.assets[1]!.browser_download_url, assetUrl: release.assets[0]!.browser_download_url,
    metadataBytes() { const body = Buffer.from(JSON.stringify(this.info)); this.release.assets[1]!.size = body.length; return body; } };
  item.metadataBytes(); return item;
}
type Artifact = ReturnType<typeof artifact>;
function network(items: Artifact[]) {
  const calls: string[] = []; const overrides = new Map<string, () => Response | Promise<Response>>();
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url; calls.push(url);
    assert.equal(init?.redirect, 'manual'); assert.equal(init?.credentials, 'omit');
    const custom = overrides.get(url); if (custom) return custom();
    for (const item of items) item.metadataBytes();
    if (url === `${API}?per_page=20`) return Response.json(items.map(item => item.release));
    for (const item of items) {
      if (url === `${API}/${item.release.id}`) return Response.json(item.release);
      if (url === item.metadataUrl) return new Response(item.metadataBytes());
      if (url === item.assetUrl) return new Response(item.bytes);
    }
    assert.fail(`Unexpected test fetch: ${url}`);
  };
  const source = (options: Partial<GithubUpdateSourceOptions> = {}) => createGithubUpdateSource({ currentVersion: '0.1.5', hostVersion: HOST, platform: 'darwin', fetch, ...options });
  return { fetch, source, calls, overrides };
}

test('check selects the newest compatible stable release and downloads metadata only', async () => {
  const newest = artifact('0.3.0', 3); newest.info.requiredDshVersion = '0.3.0';
  const windows = artifact('0.2.0', 2); windows.info.platforms = ['win32'];
  const available = artifact(); const draft = artifact('9.0.0', 9); draft.release.draft = true;
  const prerelease = artifact('8.0.0', 8); prerelease.release.prerelease = true;
  const net = network([draft, artifact('0.1.4', 4), newest, prerelease, available, windows]); const source = net.source();
  const result = await source.check(); assert.equal(result.availability, 'available'); assert.equal(result.candidate?.version, VERSION);
  assert.equal(result.candidate?.requiredDshVersion, HOST); assert.equal(result.pinned?.sha256, available.info.asset.sha256);
  assert.ok(net.calls.every(url => !url.endsWith('.tgz'))); assert.equal(net.calls.filter(url => url.endsWith('.update.json')).length, 3);
  assert.equal(JSON.stringify(result.candidate).includes('sha256'), false);
  await source.revalidate(result.pinned!); const downloaded = await source.download(result.pinned!);
  assert.deepEqual(Buffer.from(downloaded), available.bytes);
});

test('semantic ordering, exact host/OS gates, and the twenty-release/five-candidate bounds are enforced', async () => {
  const ten = artifact('0.1.10', 10); const nine = artifact('0.1.9', 9);
  assert.equal((await network([nine, ten]).source({ currentVersion: '0.1.8' }).check()).candidate?.version, '0.1.10');
  assert.equal((await network([artifact()]).source({ platform: 'win32' }).check()).availability, 'available');
  assert.equal((await network([artifact()]).source({ hostVersion: '0.2.1-rc.2' }).check()).availability, 'incompatible');
  const many = Array.from({ length: 25 }, (_, i) => { const item = artifact(`0.2.${24 - i}`, i + 1); item.info.requiredDshVersion = '0.9.0'; return item; });
  many[5]!.info.requiredDshVersion = HOST;
  const net = network(many); assert.equal((await net.source().check()).availability, 'incompatible');
  assert.equal(net.calls.filter(url => url.endsWith('.update.json')).length, 5);
  assert.equal((await network([artifact('0.1.5')]).source().check()).availability, 'current');
});

test('release metadata is strict, uses exact repository/tag URLs, and never follows arbitrary download links', async () => {
  for (const mutate of [(item: Artifact) => { item.info.asset.name = '../other.tgz'; },
    (item: Artifact) => { item.info.requiredDshVersion = '^0.2.1'; },
    (item: Artifact) => { (item.info as unknown as Record<string, unknown>).url = 'https://evil.invalid'; },
    (item: Artifact) => { item.release.assets[0]!.browser_download_url = 'https://github.com/other/repository/releases/download/v0.1.6/a.tgz'; },
    (item: Artifact) => { item.release.assets.push({ ...item.release.assets[0]! }); }]) {
    const item = artifact(); mutate(item); const net = network([item]);
    await assert.rejects(net.source().check(), { code: 'update-metadata-invalid' });
    assert.ok(net.calls.every(url => url.startsWith(API) || url.startsWith(`${WEB}/download/v${VERSION}/`)));
  }
  const item = artifact(); const net = network([item]);
  net.overrides.set(item.metadataUrl, () => new Response(null, { status: 302, headers: { location: 'https://evil.invalid/metadata' } }));
  await assert.rejects(net.source().check(), { code: 'update-redirect-rejected' }); assert.equal(net.calls.length, 2);
});

test('only bounded GitHub CDN redirects are followed and pin URLs cannot be substituted', async () => {
  const item = artifact(); const net = network([item]); const cdn = 'https://release-assets.githubusercontent.com/github-production-release-asset/123/payload?token=signed';
  net.overrides.set(item.metadataUrl, () => new Response(null, { status: 302, headers: { location: cdn } }));
  net.overrides.set(cdn, () => new Response(item.metadataBytes()));
  const source = net.source(); const checked = await source.check(); assert.equal(checked.availability, 'available');
  const calls = net.calls.length;
  await assert.rejects(source.download({ ...checked.pinned!, assetUrl: 'https://evil.invalid/package.tgz' }), { code: 'update-source-changed' });
  assert.equal(net.calls.length, calls);
  net.overrides.set(item.assetUrl, () => new Response(null, { status: 302, headers: { location: 'http://github.com/insecure' } }));
  await assert.rejects(source.download(checked.pinned!), { code: 'update-redirect-rejected' });
});

test('fresh release and metadata identities never inherit an old confirmation', async () => {
  for (const mutate of [(item: Artifact) => { item.release.assets[0]!.id++; }, (item: Artifact) => { item.release.assets[1]!.id++; },
    (item: Artifact) => { item.info.asset.sha256 = 'ab'.repeat(32); }, (item: Artifact) => { item.info.platforms = ['win32']; },
    (item: Artifact) => { item.release.prerelease = true; }, (item: Artifact) => { item.release.body = 'Changed release notes'; }]) {
    const item = artifact(); const source = network([item]).source(); const result = await source.check(); mutate(item);
    await assert.rejects(source.revalidate(result.pinned!), { code: 'update-source-changed' });
  }
  const item = artifact(); const net = network([item]); const source = net.source(); const result = await source.check();
  item.bytes = Buffer.from(item.bytes); item.bytes[20] = item.bytes[20]! ^ 1;
  await assert.rejects(source.download(result.pinned!), { code: 'update-checksum' });
});

test('packed package checks identity, compatibility, built outputs, and rejects install hooks and runtime dependencies', async () => {
  await validateUpdatePackage(gzipSync(tar(entries())), VERSION, HOST);
  for (const change of [(pkg: Record<string, any>) => { pkg.name = 'other'; }, (pkg: Record<string, any>) => { pkg.version = '0.1.7'; },
    (pkg: Record<string, any>) => { pkg.engines.dsh = '0.2.1-rc.2'; }, (pkg: Record<string, any>) => { pkg.dsh.bundle.patch = '../outside.yml'; },
    (pkg: Record<string, any>) => { pkg.dependencies = { arbitrary: 'latest' }; }, (pkg: Record<string, any>) => { pkg.optionalDependencies = { arbitrary: 'latest' }; },
    (pkg: Record<string, any>) => { pkg.bundledDependencies = ['arbitrary']; }, (pkg: Record<string, any>) => { pkg.scripts.postinstall = 'touch compromised'; },
    (pkg: Record<string, any>) => { pkg.scripts.prepare = ''; }, (pkg: Record<string, any>) => { pkg.peerDependencies.arbitrary = '*'; pkg.peerDependenciesMeta.arbitrary = { optional: true }; },
    (pkg: Record<string, any>) => { pkg.peerDependenciesMeta.react.optional = false; }, (pkg: Record<string, any>) => { pkg.peerDependencies.react = 'https://evil.invalid'; }]) {
    const pkg = manifest(); change(pkg); await assert.rejects(validateUpdatePackage(gzipSync(tar(entries(pkg))), VERSION, HOST), { code: 'update-package-invalid' });
  }
  await assert.rejects(validateUpdatePackage(gzipSync(tar(entries().filter(entry => !entry.name.endsWith('client.js')))), VERSION, HOST), { code: 'update-package-invalid' });
});

test('strict tar validation refuses traversal, Windows aliases, links, overrides, duplicates and corrupt headers', async () => {
  for (const extra of [{ name: '../outside' }, { name: '/absolute' }, { name: 'package/../outside' }, { name: 'package/C:\\outside' },
    { name: 'package/NUL.txt' }, { name: 'package/file.' }, { name: 'package/file ', type: '0' }, { name: 'package/link', type: '1' },
    { name: 'package/symlink', type: '2' }, { name: 'package/pax', type: 'x' }, { name: 'package/node_modules/arbitrary/index.js' },
    { name: 'package/package.json', data: '{}' }, { name: 'package/PACKAGE.JSON', data: '{}' }, { name: 'package/lib', data: 'file parent collision' }])
    await assert.rejects(validateUpdatePackage(gzipSync(tar([...entries(), extra])), VERSION, HOST), { code: 'update-package-invalid' });
  const damaged = tar(entries()); damaged[0] = damaged[0]! ^ 1;
  await assert.rejects(validateUpdatePackage(gzipSync(damaged), VERSION, HOST), { code: 'update-package-invalid' });
  await assert.rejects(validateUpdatePackage(gzipSync(tar(entries(), false)), VERSION, HOST), { code: 'update-package-invalid' });
  await assert.rejects(validateUpdatePackage(Buffer.from('not gzip'), VERSION, HOST), { code: 'update-package-invalid' });
});

test('download enforces packed structural and expanded limits after a matching SHA-256', async () => {
  const bad = artifact(VERSION, 1, gzipSync(tar([...entries(), { name: 'package/escape', type: '2' }])));
  const source = network([bad]).source(); const pin = (await source.check()).pinned!;
  await assert.rejects(source.download(pin), { code: 'update-package-invalid' });
  const item = artifact(); const bounded = network([item]).source({ limits: { expandedBytes: 1024 } });
  await assert.rejects(bounded.download((await bounded.check()).pinned!), { code: 'update-package-invalid' });
  const records = network([item]).source({ limits: { tarEntries: 2 } });
  await assert.rejects(records.download((await records.check()).pinned!), { code: 'update-package-invalid' });
});

test('stream size limits, rate limits, network failure, timeout and cancellation have stable errors', async () => {
  const item = artifact(); const size = network([item]);
  await assert.rejects(size.source({ limits: { releasesBytes: 32 } }).check(), { code: 'update-response-too-large' });
  for (const status of [403, 429, 503]) {
    const net = network([item]); net.overrides.set(`${API}?per_page=20`, () => new Response('unavailable', { status }));
    await assert.rejects(net.source().check(), { code: status === 503 ? 'update-network' : 'update-rate-limited' });
  }
  const unreachable: typeof fetch = async () => { throw new Error('synthetic offline'); };
  await assert.rejects(createGithubUpdateSource({ currentVersion: '0.1.5', hostVersion: HOST, platform: 'darwin', fetch: unreachable }).check(), { code: 'update-network' });
  const hanging: typeof fetch = async () => new Promise<Response>(() => {});
  await assert.rejects(createGithubUpdateSource({ currentVersion: '0.1.5', hostVersion: HOST, platform: 'darwin', fetch: hanging, timeoutMs: 5 }).check(), { code: 'update-timeout' });
  let cancelled = false; const stream = network([item]);
  stream.overrides.set(`${API}?per_page=20`, () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([91])); }, cancel() { cancelled = true; } })));
  await assert.rejects(stream.source({ timeoutMs: 5 }).check(), { code: 'update-timeout' }); assert.equal(cancelled, true);
  const controller = new AbortController(); controller.abort(); const before = size.calls.length;
  await assert.rejects(size.source().check(controller.signal), { code: 'update-cancelled' }); assert.equal(size.calls.length, before);
});

test('GitHub Retry-After and rate reset are respected without making another request', async () => {
  for (const headers of [{ 'retry-after': '7200' }, { 'retry-after': new Date(Date.now() + 7_200_000).toUTCString() },
    { 'x-ratelimit-reset': String(Math.ceil((Date.now() + 7_200_000) / 1000)) }]) {
    const net = network([artifact()]); net.overrides.set(`${API}?per_page=20`, () => new Response('limited', { status: 429, headers }));
    const source = net.source(); const now = Date.now();
    await assert.rejects(source.check(), (error: unknown) => typeof error === 'object' && error !== null
      && 'code' in error && error.code === 'update-rate-limited' && 'retryAt' in error && Number(error.retryAt) > now + 7_198_000);
    await assert.rejects(source.check(), { code: 'update-rate-limited' }); assert.equal(net.calls.length, 1);
  }
});

test('one discovery budget covers the release list and every metadata request', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const item = artifact(); const net = network([item]); let metadataStarted = false;
  net.overrides.set(`${API}?per_page=20`, () => new Promise(resolve => setTimeout(() => resolve(Response.json([item.release])), 12)));
  net.overrides.set(item.metadataUrl, () => { metadataStarted = true; return new Promise(() => {}); });
  const checking = net.source({ timeoutMs: 20 }).check(); const rejected = assert.rejects(checking, { code: 'update-timeout' });
  t.mock.timers.tick(12); await new Promise(resolve => setImmediate(resolve)); assert.equal(metadataStarted, true);
  t.mock.timers.tick(8); await rejected; assert.equal(net.calls.length, 2);
});

function dualHostArtifact() {
  const pkg = manifest(); pkg.engines.dsh = `${HOST} || 0.2.1-rc.5`;
  const item = artifact(VERSION, 1, gzipSync(tar(entries(pkg))));
  const name = item.release.assets[1]!.name.replace(/\.update\.json$/, '.dsh-0.2.1-rc.5.update.json');
  const info = { ...structuredClone(item.info), requiredDshVersion: '0.2.1-rc.5' };
  const specific = { ...item.release.assets[1]!, id: 13, name, browser_download_url: `${WEB}/download/v${VERSION}/${name}` };
  item.release.assets.push(specific);
  const metadataBytes = () => { const bytes = Buffer.from(JSON.stringify(info)); specific.size = bytes.length; return bytes; };
  metadataBytes(); return { item, info, specific, metadataBytes };
}

test('one prebuilt package declares a bounded union of exact host versions through the standard engine', async () => {
  const pkg = manifest(); const legacy = gzipSync(tar(entries(pkg)));
  assert.deepEqual(supportedPackageDshVersions(pkg), [HOST]); await validateUpdatePackage(legacy, VERSION, HOST);
  await assert.rejects(validateUpdatePackage(legacy, VERSION, '0.2.1-rc.5'), { code: 'update-package-invalid' });
  pkg.engines.dsh = `${HOST} || 0.2.1-rc.5`; const compatible = gzipSync(tar(entries(pkg)));
  assert.deepEqual(supportedPackageDshVersions(pkg), [HOST, '0.2.1-rc.5']);
  for (const host of [HOST, '0.2.1-rc.5']) await validateUpdatePackage(compatible, VERSION, host);
  for (const host of ['0.2.1-rc.2', '0.2.1-rc.4', '0.2.1']) await assert.rejects(validateUpdatePackage(compatible, VERSION, host), { code: 'update-package-invalid' });
  for (const declaration of [null, {}, [], '', `${HOST} || ${HOST}`, `${HOST} || ^0.2.1`, `${HOST} || 0.2.1-rc.05`,
    `${HOST} || 999999999999999999.0.0`, `${HOST} ||`, `${HOST}||0.2.1-rc.5`, ` ${HOST}`, `${HOST} `,
    `${HOST} || >0.2.1-rc.3`, `${HOST} || *`, `${HOST} || 0.2.1-rc.3 - 0.2.1-rc.5`,
    [HOST, ...Array.from({ length: 8 }, (_, i) => `0.2.${i}`)].join(' || ')]) {
    const invalid = manifest(); invalid.engines.dsh = declaration;
    await assert.rejects(validateUpdatePackage(gzipSync(tar(entries(invalid))), VERSION, HOST), { code: 'update-package-invalid' });
  }
  const custom = manifest(); custom.dshArchiveDelete = { supportedDshVersions: [HOST, '0.2.1-rc.5'] };
  await assert.rejects(validateUpdatePackage(gzipSync(tar(entries(custom))), VERSION, '0.2.1-rc.5'), { code: 'update-package-invalid' });
  for (const change of [(value: Record<string, any>) => { value.name = 'other'; },
    (value: Record<string, any>) => { value.scripts.postinstall = 'unexpected hook'; },
    (value: Record<string, any>) => { value.dependencies = { arbitrary: '*' }; },
    (value: Record<string, any>) => { value.peerDependenciesMeta.react.optional = false; }]) {
    const invalid = structuredClone(pkg); change(invalid);
    await assert.rejects(validateUpdatePackage(gzipSync(tar(entries(invalid))), VERSION, '0.2.1-rc.5'), { code: 'update-package-invalid' });
  }
});

test('each host selects its exact metadata and binds a separate pin to the same package bytes', async () => {
  const f = dualHostArtifact(); const net = network([f.item]); net.overrides.set(f.specific.browser_download_url, () => new Response(f.metadataBytes()));
  const first = net.source(); const second = net.source({ hostVersion: '0.2.1-rc.5' });
  const primary = await first.check(); assert.equal(primary.candidate?.requiredDshVersion, HOST);
  assert.ok(!net.calls.includes(f.specific.browser_download_url));
  const other = await second.check(); assert.equal(other.candidate?.requiredDshVersion, '0.2.1-rc.5');
  assert.notEqual(other.candidate?.id, primary.candidate?.id);
  await first.revalidate(primary.pinned!); await second.revalidate(other.pinned!);
  assert.deepEqual(await first.download(primary.pinned!), f.item.bytes); assert.deepEqual(await second.download(other.pinned!), f.item.bytes);
  await assert.rejects(first.download(other.pinned!), { code: 'update-source-changed' });
  f.specific.id++;
  await first.revalidate(primary.pinned!); await assert.rejects(second.revalidate(other.pinned!), { code: 'update-source-changed' });
});

test('specific metadata has priority, is exact and never falls back after malformed content', async () => {
  for (const mutation of [(f: ReturnType<typeof dualHostArtifact>) => { f.info.requiredDshVersion = HOST; },
    (f: ReturnType<typeof dualHostArtifact>) => { f.item.release.assets.push({ ...f.specific }); },
    (f: ReturnType<typeof dualHostArtifact>) => { f.specific.browser_download_url = `${WEB}/download/v${VERSION}/wrong.update.json`; }]) {
    const f = dualHostArtifact(); const requested = f.specific.browser_download_url; mutation(f);
    const net = network([f.item]); net.overrides.set(requested, () => new Response(f.metadataBytes()));
    const checking = net.source({ hostVersion: '0.2.1-rc.5' }).check();
    if (f.info.requiredDshVersion === HOST) assert.equal((await checking).availability, 'incompatible');
    else await assert.rejects(checking, { code: 'update-metadata-invalid' });
    assert.ok(!net.calls.includes(f.item.metadataUrl), 'an invalid exact-host asset does not cause fallback to generic metadata');
  }
  const item = artifact(); const net = network([item]);
  assert.equal((await net.source({ hostVersion: '0.2.1-rc.5' }).check()).availability, 'incompatible');
  const pkg = manifest(); pkg.engines.dsh = '0.2.1-rc.5';
  const legacy = artifact(VERSION, 1, gzipSync(tar(entries(pkg)))); legacy.info.requiredDshVersion = '0.2.1-rc.5';
  const source = network([legacy]).source({ hostVersion: '0.2.1-rc.5' });
  const checked = await source.check(); assert.equal(checked.availability, 'available');
  assert.deepEqual(await source.download(checked.pinned!), legacy.bytes, 'a legacy single-host release uses its default metadata');
  for (const hostVersion of ['^0.2.1', '0.2.1-rc.5/../other', '', '0.2.1-rc.5\0']) assert.throws(() => net.source({ hostVersion }), TypeError);
});
