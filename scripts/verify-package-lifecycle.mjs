import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { access, lstat, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
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
async function runDesktopCli(label, args) {
  const script = `import {runCli} from ${JSON.stringify(pathToFileURL(binFile).href)};process.argv=[process.execPath,${JSON.stringify(binFile)},'plugin','--profile','desktop',...${JSON.stringify(args)}];await runCli({manageDesktopProfile:true,packageManager:${JSON.stringify(packageManager)}});`;
  const value = await promisify(execFile)(process.execPath, ['--input-type=module', '--eval', script], {
    env: { ...process.env, ...options.env }, timeout: 120000, maxBuffer: 2 * 1024 * 1024,
  });
  assert.doesNotMatch(value.stdout + value.stderr, /missing peer|Issues with peer dependencies found/i);
  await record(label, { exitCode: 0, output: value.stdout + value.stderr });
}
await runDesktopCli('Desktop CLI install', base);
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
async function unregisterBundle(filename) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const value = JSON.parse(await readFile(filename, 'utf8'));
    value.dsh.profile.bundles = value.dsh.profile.bundles.filter(name => name !== source.name);
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
const mode = 'offline-package-and-loopback-url-upgrade';
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
async function verifyLoaded(dependency, seedTrash = false) {
  const plugin = await import(pathToFileURL(join(dependency, 'lib/index.js')).href); assert.equal(typeof plugin.apply, 'function');
  const ctx = new Context(); ctx.provide('profileContext', { installAnchor: context.installAnchor }); ctx.provide('dshHomePath', () => home);
  const backend = new JsonStorageBackend(join(home, 'storages')); ctx.provide('storage', { backend: { get: () => backend } });
  const domains = new DomainFacility(ctx, { backend: 'json' }); ctx.provide('storageDomain', domains); const sessions = new SessionStore(ctx);
  const projections = new SessionProjectionRegistry(ctx); projections.register(titleProjectionDefinition);
  const cache = new SessionProjectionCache(ctx, { writeEveryEvents: 200, writeIntervalMs: 5000 }); await cache[Service.init]();
  await mkdir(join(home, 'sessions'), { recursive: true }); await jsonl.apply(ctx, { root: join(home, 'sessions'), compression: 'none' });
  const registry = new WorkspaceRegistry(ctx); await registry[Service.init]();
  const connection = new HostConnectionService(ctx, ['127.0.0.1'], { isAuthenticated: () => true, authenticateApi: () => undefined });
  const unmount = await plugin.apply(ctx);
  const handler = connection.createSharedFetchHandler('/api');
  async function request(body) {
    const response = await handler.fetch(new Request('http://127.0.0.1/api/dsh-archive-delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), connection.browserPeer);
    const result = await response.json(); assert.equal(result.ok, true, JSON.stringify(result)); return result.value;
  }
  let overview;
  try {
    overview = await request({ action: 'list' }); assert.equal(overview.support.supported, true, JSON.stringify(overview));
    if (seedTrash) {
      const project = join(home, 'synthetic-upgrade-project'); await mkdir(project);
      const workspace = await registry.create(project, 'Synthetic upgrade project');
      const prepared = sessions.prepare('synthetic-upgrade-retention', { meta: { cwd: project, createdAt: 1000 } });
      const persistence = ctx.get('sessionPersistence'); const writer = await persistence.create(prepared.header, { inheritedEventCount: 0 });
      await writer.append([{ type: 'session/title', seq: 0, time: 1001, data: { title: 'Synthetic upgrade retention', messageSeqs: [], source: { kind: 'user' } } }]);
      await writer.flush(); await writer.close();
      await registry.indexHeader(prepared.header); await workspace.attachSession(prepared.id); await registry.archiveSession(prepared.id);
      const preview = await request({ action: 'preview', operation: 'trash', ids: [prepared.id] });
      const result = await request({ action: 'execute', previewId: preview.id, requestId: randomUUID() });
      assert.equal(result.items[0].status, 'moved'); overview = await request({ action: 'list' });
      assert.equal(overview.trash.length, 1);
    }
  } finally { await unmount(); await domains.closeAll(); await backend.close(); }
  for (const name of ['trash', 'staging', 'receipts', 'operations']) assert.equal((await lstat(join(home, 'archive-delete', name))).isDirectory(), true);
  return overview;
}
await verifyLoaded(join(cliProfile, 'node_modules/@qwqbig/dsh-archive-delete'));
await verifyLoaded(join(manualProfile, 'node_modules/@qwqbig/dsh-archive-delete'));
await record('explicit bundle registration and authenticated API load', { exitCode: 0 });
const beforeUpgrade = await verifyLoaded(dependency, true);

const doctorFile = join(dependency, 'lib', 'doctor.js');
const doctorArgs = ['--home', home, '--profile', 'web', '--runtime', runtime, '--json'];
const doctorOutput = await promisify(execFile)(process.execPath, [doctorFile, ...doctorArgs], { timeout: 15000 });
const doctor = JSON.parse(doctorOutput.stdout);
assert.equal(doctor.ok, true, JSON.stringify(doctor));
assert.equal(doctor.plugin.version, source.version);
assert.equal(doctor.runtimeState, 'unverified');
assert.equal(doctor.checks.find(check => check.id === 'bundle-registration').code, 'bundle-registered');
const invalidDoctor = await execa(process.execPath, [doctorFile, '--profile', '../desktop', '--json'], { reject: false, timeout: 15000 });
assert.equal(invalidDoctor.exitCode, 2);
assert.equal(JSON.parse(invalidDoctor.stdout).error.code, 'doctor-usage');
await record('packed Doctor CLI validates the isolated profile without claiming live activation', { exitCode: 0 });

// A local HTTP fixture exercises the same immutable-URL replacement semantics
// as versioned Release assets without depending on a public network or git.
const oldVersion = '0.0.0-installation-fixture';
const oldSource = join(root, 'synthetic-old-package'); await mkdir(join(oldSource, 'lib'), { recursive: true });
await writeFile(join(oldSource, 'package.json'), JSON.stringify({ name: source.name, version: oldVersion, type: 'module', license: source.license,
  main: './lib/index.js', files: ['lib', 'cordis.patch.yml'], engines: source.engines,
  dsh: { manifestVersion: 1, bundle: { patch: './cordis.patch.yml' } } }, null, 2));
await writeFile(join(oldSource, 'lib/index.js'), 'export function apply() {}\n');
await writeFile(join(oldSource, 'cordis.patch.yml'), await readFile(new URL('../cordis.patch.yml', import.meta.url)));
const packedOld = await execa(packageManager.command, [...packageManager.args, 'pack', '--pack-destination', oldSource], {
  cwd: oldSource, env: { ...process.env, ...options.env }, timeout: 120000, reject: false,
});
assert.equal(packedOld.exitCode, 0, packedOld.stdout + packedOld.stderr);
const oldTarball = (await readdir(oldSource)).find(name => name.endsWith('.tgz')); assert.ok(oldTarball);
const routes = new Map([
  [`/v${oldVersion}/package.tgz`, await readFile(join(oldSource, oldTarball))],
  [`/v${source.version}/${defaultFile}`, await readFile(packageFile)],
]);
const hits = [];
const server = createServer((request, response) => {
  const data = routes.get(request.url);
  if (!data) { response.writeHead(404); response.end(); return; }
  hits.push(request.url); response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': data.length });
  response.end(request.method === 'HEAD' ? undefined : data);
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
server.unref();
const address = server.address(); assert.ok(address && typeof address === 'object');
const origin = `http://127.0.0.1:${address.port}`;
const upgradeProfile = join(home, 'profiles', 'url-upgrade'); await mkdir(upgradeProfile, { recursive: true });
initProfile(upgradeProfile, originalCliManifest.dsh.profile.bundles);
const upgradeManifestFile = join(upgradeProfile, 'package.json');
const upgradeInitial = JSON.parse(await readFile(upgradeManifestFile, 'utf8'));
upgradeInitial['x-retained-fixture'] = { nested: ['keep', 'these settings'], enabled: true };
await writeFile(upgradeManifestFile, JSON.stringify(upgradeInitial, null, 2) + '\n');
const upgradeContext = { ...context, profile: 'url-upgrade', dir: upgradeProfile };
const networkOptions = { ...options, env: { ...options.env, npm_config_offline: 'false', PNPM_OFFLINE: 'false',
  npm_config_proxy: '', npm_config_https_proxy: '', npm_config_noproxy: '127.0.0.1,localhost' } };
const upgradeEntry = beforeUpgrade.trash[0]; assert.ok(upgradeEntry);
const retainedLog = join(home, 'archive-delete', 'trash', upgradeEntry.id, '0', 'session.v4.jsonl');
const retainedBytes = await readFile(retainedLog);
try {
  const [oldPath, newPath] = [...routes.keys()];
  for (const [label, spec, expectedVersion] of [
    ['install synthetic older fixed-URL package', origin + oldPath, oldVersion],
    ['replace fixed-URL dependency with the new version URL', origin + newPath, source.version],
  ]) {
    const result = await runPluginCommand(upgradeContext, ['add', spec, '--ignore-scripts', '--registry=http://127.0.0.1:9'], networkOptions);
    await record(label, { exitCode: result.exitCode, logPath: result.logPath, output: result.output }); assert.equal(result.exitCode, 0);
    const saved = JSON.parse(await readFile(upgradeManifestFile, 'utf8')); assert.equal(saved.dependencies[source.name], spec);
    assert.deepEqual(saved.dsh.profile.bundles, [...originalCliManifest.dsh.profile.bundles, source.name]);
    assert.deepEqual(saved['x-retained-fixture'], upgradeInitial['x-retained-fixture']);
    assert.equal(JSON.parse(await readFile(join(upgradeProfile, 'node_modules', source.name, 'package.json'), 'utf8')).version, expectedVersion);
    assert.deepEqual(await readFile(retainedLog), retainedBytes);
  }
  for (const path of routes.keys()) assert.ok(hits.includes(path), `Expected the versioned URL to be requested: ${path}`);
  const reopened = await verifyLoaded(join(upgradeProfile, 'node_modules', source.name));
  assert.equal(reopened.trash[0].id, upgradeEntry.id); assert.deepEqual(await readFile(retainedLog), retainedBytes);
  await record('fixed-URL upgrade retains trash and loads the current authenticated API', { exitCode: 0 });
} finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }

const saved = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8')); assert.ok(saved.dsh.profile.bundles.includes(manifest.name));
const marker = join(home, 'archive-delete/trash', randomUUID()); await mkdir(marker, { recursive: true });
const markerFile = join(marker, 'synthetic-retention-marker.json'); const markerText = JSON.stringify({ synthetic: true, intent: 'Uninstall must retain the plugin trash store.' }); await writeFile(markerFile, markerText);
// Raw dependency removal reproduces carriers that leave a dead bundle entry.
const manualBeforeRemoval = JSON.parse(await readFile(manualManifestFile, 'utf8'));
manualBeforeRemoval['x-retained-fixture'] = { nested: ['keep', 'these settings'], enabled: true };
await writeFile(manualManifestFile, JSON.stringify(manualBeforeRemoval, null, 2) + '\n');
const rawRemoval = await execa(packageManager.command, [...packageManager.args, 'remove', manifest.name], {
  cwd: manualProfile, env: { ...process.env, ...options.env }, timeout: 120000, reject: false,
});
await record('pnpm removal leaves a stale bundle until explicit cleanup', { exitCode: rawRemoval.exitCode, output: rawRemoval.stdout + rawRemoval.stderr });
assert.equal(rawRemoval.exitCode, 0);
const rawRemoved = JSON.parse(await readFile(manualManifestFile, 'utf8'));
assert.equal(rawRemoved.dependencies?.[manifest.name], undefined); assert.ok(rawRemoved.dsh.profile.bundles.includes(manifest.name));
assert.deepEqual(rawRemoved['x-retained-fixture'], manualBeforeRemoval['x-retained-fixture']);
await assert.rejects(access(join(manualProfile, 'node_modules', manifest.name)), { code: 'ENOENT' });
await unregisterBundle(manualManifestFile);
const explicitlyRemoved = JSON.parse(await readFile(manualManifestFile, 'utf8'));
assert.deepEqual(explicitlyRemoved, { ...rawRemoved, dsh: { ...rawRemoved.dsh, profile: { ...rawRemoved.dsh.profile,
  bundles: rawRemoved.dsh.profile.bundles.filter(name => name !== manifest.name),
} } });
assert.equal(await readFile(markerFile, 'utf8'), markerText); assert.deepEqual(await readFile(retainedLog), retainedBytes);
await record('explicit stale-bundle cleanup is idempotent and retains other profile fields and trash', { exitCode: 0 });
await runDesktopCli('Desktop CLI uninstall', ['remove', manifest.name]);
const cliRemoved = JSON.parse(await readFile(cliManifestFile, 'utf8')); assert.equal(cliRemoved.dependencies?.[manifest.name], undefined);
const cliStale = cliRemoved.dsh.profile.bundles.includes(manifest.name);
assert.deepEqual(cliRemoved.dsh.profile.bundles, [...originalCliManifest.dsh.profile.bundles, ...(cliStale ? [manifest.name] : [])]);
await record(`Desktop CLI uninstall bundle ${cliStale ? 'requires explicit cleanup' : 'automatically removed'}`, { exitCode: 0 });
await unregisterBundle(cliManifestFile); assert.equal(await readFile(markerFile, 'utf8'), markerText);
assert.equal((await run('reinstall packed package', base)).exitCode, 0);
assert.equal(await readFile(markerFile, 'utf8'), markerText);
assert.equal((await run('uninstall package', ['remove', manifest.name])).exitCode, 0);
assert.equal(await readFile(markerFile, 'utf8'), markerText);
const removed = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8')); assert.equal(removed.dependencies?.[manifest.name], undefined); assert.ok(!removed.dsh.profile.bundles.includes(manifest.name));
await writeFile(join(root, 'result.json'), JSON.stringify({ passed: true, mode, root, profile, markerFile, packageFile, peerNames: Object.keys(manifest.peerDependencies) }, null, 2));
console.log(`Package lifecycle verified / 已验证包生命周期 (${mode}); evidence / 证据: ${root}`);
