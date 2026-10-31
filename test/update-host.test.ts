import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import test, { type TestContext } from 'node:test';
import { PACKAGE_NAME, SUPPORTED_DSH_VERSION, SUPPORTED_DSH_VERSIONS } from '../src/contracts.js';
import { createUpdateHost } from '../src/update-host.js';
import { PLUGIN_VERSION } from '../src/version.js';
import type { HostContext } from '../src/dsh-adapter.js';

function packedFixture(version: string, hosts?: readonly string[]): Buffer {
  const manifest = { name: PACKAGE_NAME, version, type: 'module', main: './lib/index.js',
    engines: { node: '>=24', dsh: (hosts ?? [SUPPORTED_DSH_VERSION]).join(' || ') },
    dsh: { manifestVersion: 1, bundle: { patch: './cordis.patch.yml' } } };
  const files = new Map([['package/package.json', JSON.stringify(manifest)], ['package/lib/index.js', 'export const name="synthetic";'],
    ['package/lib/client.js', '/* synthetic */'], ['package/cordis.patch.yml', '[]\n']]);
  const chunks: Buffer[] = [];
  for (const [name, content] of files) {
    const bytes = Buffer.from(content); const header = Buffer.alloc(512);
    header.write(name); header.write('0000644\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116);
    header.write(`${bytes.length.toString(8).padStart(11, '0')}\0`, 124); header.write('00000000000\0', 136);
    header.fill(32, 148, 156); header.write('0', 156); header.write('ustar\0', 257); header.write('00', 263);
    const checksum = header.reduce((sum, byte) => sum + byte, 0); header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148);
    chunks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}

async function fixture(t: TestContext, hostVersion = SUPPORTED_DSH_VERSION as string) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'archive-update-host-'))); t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'home'); const dir = join(home, 'profiles', 'synthetic'); const runtime = join(root, 'runtime');
  const anchor = join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'package.json');
  const managerRoot = join(runtime, 'node_modules', '@deepseek-ai', 'dsh-plugin-manager');
  const installedRoot = join(dir, 'node_modules', PACKAGE_NAME); const packages = join(home, 'archive-delete', 'updates', 'packages');
  await Promise.all([mkdir(installedRoot, { recursive: true }), mkdir(managerRoot + '/lib', { recursive: true }), mkdir(join(anchor, '..'), { recursive: true }), mkdir(packages, { recursive: true })]);
  await writeFile(anchor, JSON.stringify({ name: '@deepseek-ai/dsh', version: hostVersion }));
  await writeFile(join(managerRoot, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-plugin-manager', version: hostVersion, type: 'module', main: 'lib/index.js' }));
  const moduleFile = join(managerRoot, 'lib', 'index.js');
  await writeFile(moduleFile, 'export class PluginManager { constructor(profile) { this.profile=profile; } async listBundles(){return this.rows;} async installBundle(){throw Error("not configured");} }');
  const native = await import(pathToFileURL(moduleFile).href);
  const profile = { name: 'synthetic', home, dir, installAnchor: anchor };
  const manager = new native.PluginManager(profile);
  const source = 'https://github.com/QwQBiG/dsh-archive-delete/releases/download/v0.1.0/old.tgz';
  const row = { name: PACKAGE_NAME, version: '0.1.0', source, installed: true, availability: 'profile', removable: true };
  manager.rows = [row];
  const ctx: HostContext = { profileContext: profile, pluginManager: manager };
  const save = async (version = row.version, spec = source) => {
    row.version = version; row.source = spec;
    await writeFile(join(dir, 'package.json'), JSON.stringify({ private: true, dependencies: { [PACKAGE_NAME]: spec }, dsh: { profile: { bundles: [PACKAGE_NAME] } } }));
    await writeFile(join(installedRoot, 'package.json'), JSON.stringify({ name: PACKAGE_NAME, version, dsh: { bundle: { patch: 'cordis.patch.yml' } } }));
  };
  await save();
  const version = '0.1.9'; const packed = packedFixture(version, hostVersion === SUPPORTED_DSH_VERSION ? undefined : [SUPPORTED_DSH_VERSION, hostVersion]);
  const packagePath = join(packages, `${version}-${createHash('sha256').update(packed).digest('hex')}.tgz`); await writeFile(packagePath, packed, { mode: 0o600 });
  return { root, home, dir, profile, anchor, manager, managerRoot, row, ctx, installedRoot, packagePath, version, save };
}

test('native update target reports loaded and installed versions separately and retains the private source', async t => {
  const f = await fixture(t); const adapter = await createUpdateHost(f.ctx);
  assert.equal(adapter.canInstall, true); assert.equal(adapter.hostVersion, SUPPORTED_DSH_VERSION); assert.equal(adapter.loadedVersion, PLUGIN_VERSION);
  assert.deepEqual(await adapter.installed(), { version: '0.1.0', source: f.row.source });
});

test('missing or mismatched host manager, runtime and profile do not grant installation', async t => {
  for (const variant of ['missing', 'shape-only', 'wrong-profile', 'wrong-version', 'built-in', 'collision', 'outside-link'] as const) {
    const f = await fixture(t);
    if (variant === 'missing') delete f.ctx.pluginManager;
    if (variant === 'shape-only') f.ctx.pluginManager = { ...f.manager };
    if (variant === 'wrong-profile') f.manager.profile = { ...f.profile, name: 'other', dir: join(f.home, 'profiles', 'other') };
    if (variant === 'wrong-version') await writeFile(f.anchor, JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.1-rc.2' }));
    if (variant === 'built-in') f.row.availability = 'installation';
    if (variant === 'collision') await writeFile(join(f.installedRoot, 'package.json'), JSON.stringify({ name: 'different-package', version: '0.1.0' }));
    if (variant === 'outside-link') {
      const outside = join(f.root, 'checkout'); await mkdir(outside); await writeFile(join(outside, 'package.json'), JSON.stringify({ name: PACKAGE_NAME, version: '0.1.0' }));
      await rm(f.installedRoot, { recursive: true }); await symlink(outside, f.installedRoot, process.platform === 'win32' ? 'junction' : 'dir');
    }
    const adapter = await createUpdateHost(f.ctx); assert.equal(adapter.canInstall, false, variant);
    assert.equal((await adapter.install(f.packagePath, f.version, randomUUID())).status, 'failed', variant);
  }
});

test('install delegates to the host once and verifies dependency path/version and activation result', async t => {
  for (const hostVersion of SUPPORTED_DSH_VERSIONS) for (const application of ['applied', 'restart-required'] as const) {
    const f = await fixture(t, hostVersion); const requestId = randomUUID(); let calls = 0;
    f.manager.installBundle = async (path: string, options: unknown) => {
      calls++; assert.equal(path, f.packagePath); assert.deepEqual(options, { requestId, saveExact: true, enabled: true });
      await f.save(f.version, `file:${f.packagePath}`);
      return { bundle: PACKAGE_NAME, version: f.version, application, packageResult: { exitCode: 0 } };
    };
    const adapter = await createUpdateHost(f.ctx);
    assert.equal(adapter.canInstall, true); assert.equal(adapter.hostVersion, hostVersion);
    assert.deepEqual(await adapter.install(f.packagePath, f.version, requestId), { status: application === 'applied' ? 'installed' : 'restart-required' });
    assert.equal(calls, 1); assert.equal(adapter.loadedVersion, PLUGIN_VERSION);
  }
});

test('native updater accepts only explicit host versions with a matching manager generation', async t => {
  for (const hostVersion of ['0.2.1-rc.2', '0.2.1-rc.4', '0.2.1', '0.2.2']) {
    const f = await fixture(t, hostVersion); assert.equal((await createUpdateHost(f.ctx)).canInstall, false, hostVersion);
  }
  const f = await fixture(t, '0.2.1-rc.5');
  await writeFile(join(f.managerRoot, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-plugin-manager', version: SUPPORTED_DSH_VERSION, type: 'module', main: 'lib/index.js' }));
  assert.equal((await createUpdateHost(f.ctx)).canInstall, false, 'a manager from another host generation is refused');
});

test('only a canonical server package filename inside the persistent private package directory is admitted', async t => {
  const f = await fixture(t); let calls = 0; f.manager.installBundle = async () => { calls++; return {}; };
  const adapter = await createUpdateHost(f.ctx);
  const link = join(f.packagePath, '..', `${f.version}-${'b'.repeat(64)}.tgz`);
  try { await symlink(f.packagePath, link, 'file'); }
  catch (error) { if (process.platform !== 'win32' || (error as NodeJS.ErrnoException).code !== 'EPERM') throw error; }
  for (const path of [join(f.root, 'browser.tgz'), f.packagePath.replace(f.version, '0.1.8'), link, 'relative.tgz'])
    assert.equal((await adapter.install(path, f.version, randomUUID())).status, 'failed');
  assert.equal(calls, 0);
  assert.deepEqual(await adapter.install(f.packagePath, f.version, 'not-an-id'), { status: 'failed', code: 'invalid-request' });
});

test('native refusals, build approvals, package failures and uncertain outcomes never become success', async t => {
  for (const result of [{ application: 'failed', error: { code: 'already-installed' } },
    { application: 'failed', error: { code: 'bundle-in-use' } }, { application: 'failed', error: { code: 'stop-profile' } },
    { application: 'applied', pendingBuilds: ['dependency'] }, { application: 'applied', packageResult: { exitCode: 1 } },
    { application: 'applied', bundle: PACKAGE_NAME, version: '0.1.9' }, null]) {
    const f = await fixture(t); f.manager.installBundle = async () => result;
    const adapter = await createUpdateHost(f.ctx); const outcome = await adapter.install(f.packagePath, f.version, randomUUID());
    assert.ok(['failed', 'unknown'].includes(outcome.status)); assert.equal((await adapter.installed()).version, '0.1.0');
  }
  const f = await fixture(t); f.manager.installBundle = async () => { throw new Error('lost native result'); };
  assert.deepEqual(await (await createUpdateHost(f.ctx)).install(f.packagePath, f.version, randomUUID()), { status: 'unknown', code: 'update-install-unknown' });
});

test('replaced profile or manager is rejected immediately before handing control to the host', async t => {
  const f = await fixture(t); const adapter = await createUpdateHost(f.ctx); let called = false;
  f.manager.installBundle = async () => { called = true; return {}; };
  f.ctx.profileContext = { ...f.profile, dir: join(f.root, 'other') };
  assert.equal((await adapter.install(f.packagePath, f.version, randomUUID())).status, 'failed'); assert.equal(called, false);
  const changed = await fixture(t); const original = await createUpdateHost(changed.ctx);
  changed.profile.name = 'other'; changed.profile.dir = join(changed.home, 'profiles', 'other');
  await assert.rejects(() => original.installed(), { code: 'update-host-unavailable' });
});

test('disk bytes must still match the digest and packed version when the host is about to install', async t => {
  for (const change of ['digest', 'manifest'] as const) {
    const f = await fixture(t); let called = false;
    f.manager.installBundle = async () => { called = true; return {}; };
    const adapter = await createUpdateHost(f.ctx); let path = f.packagePath;
    if (change === 'digest') await appendFile(path, 'tampered');
    else {
      const bytes = packedFixture('0.1.8'); path = join(f.packagePath, '..', `${f.version}-${createHash('sha256').update(bytes).digest('hex')}.tgz`);
      await writeFile(path, bytes, { mode: 0o600 });
    }
    assert.equal((await adapter.install(path, f.version, randomUUID())).status, 'failed'); assert.equal(called, false);
  }
});
