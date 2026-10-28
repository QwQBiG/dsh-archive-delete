import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, lstat, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const runtime = process.env.DSH_RUNTIME_ROOT ?? '/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh';
const nativeRequire = createRequire(join(runtime, 'package.json'));
const source = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const defaultFile = `${source.name.replace(/^@/, '').replaceAll('/', '-')}-${source.version}.tgz`;
const input = resolve(process.argv[2] ?? defaultFile);
let packageFile = input;
if ((await lstat(input)).isDirectory()) {
  const candidates = (await readdir(input)).filter(name => name.endsWith('.tgz'));
  assert.equal(candidates.length, 1, 'Package directory must contain exactly one .tgz / 安装包目录必须恰好包含一个 .tgz');
  packageFile = join(input, candidates[0]);
}
await access(packageFile);
const host = (name) => import(pathToFileURL(nativeRequire.resolve(name)).href);
const { initProfile } = await host('@deepseek-ai/dsh-app-boot');
const { runPluginCommand } = await host('@deepseek-ai/dsh-plugin-manager/operations');
const managerRequire = createRequire(nativeRequire.resolve('@deepseek-ai/dsh-plugin-manager/operations'));
const { execa } = await import(pathToFileURL(managerRequire.resolve('execa')).href);
const { Context, Service } = await host('@deepseek-ai/cordis');
const { SessionStore } = await host('@deepseek-ai/dsh-session');
const { DomainFacility } = await host('@deepseek-ai/dsh-storage-domain');
const { JsonStorageBackend } = await host('@deepseek-ai/dsh-storage-json');
const { SessionProjectionRegistry } = await host('@deepseek-ai/dsh-session-projection');
const { titleProjectionDefinition } = await host('@deepseek-ai/dsh-session-title');
const { SessionProjectionCache } = await host('@deepseek-ai/dsh-session-projection-cache');
const { WorkspaceRegistry } = await host('@deepseek-ai/dsh-workspace');
const { HostConnectionService } = await host('@deepseek-ai/dsh-client-connection');
const jsonl = await host('@deepseek-ai/dsh-session-persistence-jsonl');
const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-package-lifecycle-')));
const home = join(root, 'home'); const profile = join(home, 'profiles', 'web'); await mkdir(profile, { recursive: true });
initProfile(profile, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']);
const pnpmFile = process.env.DSH_PNPM_CLI ?? '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.cjs';
let packageManager;
try { await access(pnpmFile); packageManager = { command: process.execPath, args: [pnpmFile] }; }
catch (error) { if (error.code !== 'ENOENT') throw error; packageManager = { command: 'pnpm', args: [] }; }
const context = { profile: 'web', dir: profile, home, installAnchor: join(runtime, 'node_modules/@deepseek-ai/dsh/package.json'), cwd: process.cwd() };
const options = { ...packageManager, execution: 'cli', outputBytes: 16384, lockWaitMs: 5000, lookupTimeoutMs: 5000, idleTimeoutMs: 15000,
  env: { DSH_HOME: home, npm_config_offline: 'true', npm_config_registry: 'http://127.0.0.1:9', npm_config_manage_package_manager_versions: 'false', PNPM_OFFLINE: 'true' } };
const records = [];
async function record(label, value) {
  records.push({ label, ...value });
  await writeFile(join(root, 'evidence.json'), JSON.stringify({ root, runtime, packageFile, records }, null, 2));
  console.log(`${label}: exit=${value.exitCode}${value.logPath ? `, diagnostics=${value.logPath}` : ''}`);
}
async function run(label, args) {
  const value = await runPluginCommand(context, args, options);
  await record(label, { exitCode: value.exitCode, logPath: value.logPath, output: value.output }); return value;
}
const base = ['add', packageFile, '--offline', '--ignore-scripts', '--registry=http://127.0.0.1:9'];
// Exercise the actual Desktop launcher. Carriers may activate newly installed
// bundles themselves; the documented post-install check must cover both paths.
const cliProfile = join(home, 'profiles', 'desktop'); await mkdir(cliProfile, { recursive: true });
initProfile(cliProfile, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']);
const cliManifestFile = join(cliProfile, 'package.json');
const originalCliManifest = JSON.parse(await readFile(cliManifestFile, 'utf8'));
const binFile = nativeRequire.resolve('@deepseek-ai/dsh/lib/bin.js');
const cliScript = `import {runCli} from ${JSON.stringify(pathToFileURL(binFile).href)};process.argv=[process.execPath,${JSON.stringify(binFile)},'plugin','--profile','desktop',...${JSON.stringify(base)}];await runCli({manageDesktopProfile:true,packageManager:${JSON.stringify(packageManager)}});`;
const cliResult = await promisify(execFile)(process.execPath, ['--input-type=module', '--eval', cliScript], {
  env: { ...process.env, ...options.env }, timeout: 120000, maxBuffer: 2 * 1024 * 1024,
});
assert.doesNotMatch(cliResult.stdout + cliResult.stderr, /missing peer|Issues with peer dependencies found/i);
await record('Desktop CLI install', { exitCode: 0, output: cliResult.stdout + cliResult.stderr });
const cliInstalled = JSON.parse(await readFile(cliManifestFile, 'utf8'));
assert.ok(cliInstalled.dependencies?.[source.name]);
const cliActivated = cliInstalled.dsh.profile.bundles.includes(source.name);
assert.deepEqual(cliInstalled.dsh.profile.bundles, [...originalCliManifest.dsh.profile.bundles, ...(cliActivated ? [source.name] : [])]);
await assert.rejects(access(join(home, 'archive-delete')), { code: 'ENOENT' });
await record(`Desktop CLI bundle ${cliActivated ? 'automatically registered' : 'requires explicit registration'}`, { exitCode: 0 });
// A direct pnpm invocation models installation-only carriers without relying on
// optional activation flags that are absent in some host builds.
const manualProfile = join(home, 'profiles', 'install-only'); await mkdir(manualProfile, { recursive: true });
initProfile(manualProfile, originalCliManifest.dsh.profile.bundles);
const manualManifestFile = join(manualProfile, 'package.json');
const installOnly = await execa(packageManager.command, [...packageManager.args, ...base], {
  cwd: manualProfile, env: { ...process.env, ...options.env }, timeout: 120000, reject: false,
});
await record('pnpm installation without bundle activation', { exitCode: installOnly.exitCode, output: installOnly.stdout + installOnly.stderr });
assert.equal(installOnly.exitCode, 0);
assert.doesNotMatch(installOnly.stdout + installOnly.stderr, /missing peer|Issues with peer dependencies found/i);
const manualInstalled = JSON.parse(await readFile(manualManifestFile, 'utf8'));
assert.ok(manualInstalled.dependencies?.[source.name]);
assert.deepEqual(manualInstalled.dsh.profile.bundles, originalCliManifest.dsh.profile.bundles);
// Mirror the documented, explicit manifest edit; a repeated edit must not add
// duplicates or replace the rest of the user's profile configuration.
async function registerBundle(filename) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const value = JSON.parse(await readFile(filename, 'utf8'));
    value.dsh.profile.bundles = [...new Set([...value.dsh.profile.bundles, source.name])];
    await writeFile(filename, JSON.stringify(value, null, 2) + '\n');
  }
}
await registerBundle(manualManifestFile);
await registerBundle(cliManifestFile);
const manualRegistered = JSON.parse(await readFile(manualManifestFile, 'utf8'));
assert.deepEqual(manualRegistered, { ...manualInstalled, dsh: { ...manualInstalled.dsh, profile: {
  ...manualInstalled.dsh.profile, bundles: [...originalCliManifest.dsh.profile.bundles, source.name],
} } });

const added = await run('manager offline install with automatic bundle registration', base);
const mode = 'normal-offline-cache';
assert.equal(added.exitCode, 0, `Package installation failed; evidence retained at ${root}`);
const dependency = join(profile, 'node_modules/@qwqbig/dsh-archive-delete');
const manifest = JSON.parse(await readFile(join(dependency, 'package.json'), 'utf8'));
assert.equal(manifest.name, '@qwqbig/dsh-archive-delete');
assert.equal(manifest.version, source.version);
for (const name of Object.keys(manifest.peerDependencies)) assert.equal(manifest.peerDependenciesMeta?.[name]?.optional, true, `${name} must be supplied optionally by the host`);
// React is provided by the browser ModuleLoader, not by Node's package tree.
for (const name of Object.keys(manifest.peerDependencies).filter(name => name.startsWith('@deepseek-ai/') && name !== '@deepseek-ai/node-addon-system')) nativeRequire.resolve(name);
if (process.platform === 'win32') createRequire(nativeRequire.resolve('@deepseek-ai/dsh-session-persistence-jsonl')).resolve('koffi');
else nativeRequire.resolve('@deepseek-ai/node-addon-system/flock');
await access(join(dependency, 'lib/index.js')); assert.match(await readFile(join(dependency, 'lib/client.js'), 'utf8'), /window\.__ModuleLoader__\.load/);
// Import the packed host with normal Node resolution: no test hook supplies its peers.
async function verifyLoaded(dependency) {
  const plugin = await import(pathToFileURL(join(dependency, 'lib/index.js')).href); assert.equal(typeof plugin.apply, 'function');
  const ctx = new Context(); ctx.provide('profileContext', { installAnchor: context.installAnchor }); ctx.provide('dshHomePath', () => home);
  const backend = new JsonStorageBackend(join(home, 'storages')); ctx.provide('storage', { backend: { get: () => backend } });
  const domains = new DomainFacility(ctx, { backend: 'json' }); ctx.provide('storageDomain', domains); new SessionStore(ctx);
  const projections = new SessionProjectionRegistry(ctx); projections.register(titleProjectionDefinition);
  const cache = new SessionProjectionCache(ctx, { writeEveryEvents: 200, writeIntervalMs: 5000 }); await cache[Service.init]();
  await mkdir(join(home, 'sessions'), { recursive: true }); await jsonl.apply(ctx, { root: join(home, 'sessions'), compression: 'none' });
  const registry = new WorkspaceRegistry(ctx); await registry[Service.init]();
  const connection = new HostConnectionService(ctx, ['127.0.0.1'], { isAuthenticated: () => true, authenticateApi: () => undefined });
  const unmount = await plugin.apply(ctx);
  const response = await connection.createSharedFetchHandler('/api').fetch(new Request('http://127.0.0.1/api/dsh-archive-delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'list' }) }), connection.browserPeer);
  const overview = await response.json(); assert.equal(overview.ok, true); assert.equal(overview.value.support.supported, true, JSON.stringify(overview));
  await unmount(); await domains.closeAll(); await backend.close();
  for (const name of ['trash', 'staging', 'receipts', 'operations']) assert.equal((await lstat(join(home, 'archive-delete', name))).isDirectory(), true);
}
await verifyLoaded(join(cliProfile, 'node_modules/@qwqbig/dsh-archive-delete'));
await verifyLoaded(join(manualProfile, 'node_modules/@qwqbig/dsh-archive-delete'));
await record('explicit bundle registration and authenticated API load', { exitCode: 0 });
await verifyLoaded(dependency);

const saved = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8')); assert.ok(saved.dsh.profile.bundles.includes(manifest.name));
const marker = join(home, 'archive-delete/trash', randomUUID()); await mkdir(marker, { recursive: true });
const markerFile = join(marker, 'synthetic-retention-marker.json'); const markerText = JSON.stringify({ synthetic: true, intent: 'Uninstall must retain the plugin trash store.' }); await writeFile(markerFile, markerText);
assert.equal((await run('reinstall packed package', base)).exitCode, 0);
assert.equal(await readFile(markerFile, 'utf8'), markerText);
assert.equal((await run('uninstall package', ['remove', manifest.name])).exitCode, 0);
assert.equal(await readFile(markerFile, 'utf8'), markerText);
const removed = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8')); assert.equal(removed.dependencies?.[manifest.name], undefined); assert.ok(!removed.dsh.profile.bundles.includes(manifest.name));
await writeFile(join(root, 'result.json'), JSON.stringify({ passed: true, mode, root, profile, markerFile, packageFile, peerNames: Object.keys(manifest.peerDependencies) }, null, 2));
console.log(`Package lifecycle verified / 已验证包生命周期 (${mode}); evidence / 证据: ${root}`);
