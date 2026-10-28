import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const runtime = process.env.DSH_RUNTIME_ROOT ?? '/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh';
const nativeRequire = createRequire(join(runtime, 'package.json'));
const packageFile = resolve(process.argv[2] ?? 'qwqbig-dsh-archive-delete-0.1.0.tgz');
await access(packageFile);
const host = (name) => import(pathToFileURL(nativeRequire.resolve(name)).href);
const { initProfile } = await host('@deepseek-ai/dsh-app-boot');
const { runPluginCommand } = await host('@deepseek-ai/dsh-plugin-manager/operations');
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
const root = await mkdtemp(join(tmpdir(), 'dsh-package-lifecycle-'));
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
async function run(label, args) {
  const value = await runPluginCommand(context, args, options); records.push({ label, exitCode: value.exitCode, logPath: value.logPath, output: value.output });
  await writeFile(join(root, 'evidence.json'), JSON.stringify({ root, runtime, packageFile, records }, null, 2));
  console.log(`${label}: exit=${value.exitCode}, diagnostics=${value.logPath}`); return value;
}
const base = ['add', packageFile, '--offline', '--ignore-scripts', '--registry=http://127.0.0.1:9'];
const added = await run('normal offline install', base);
const mode = 'normal-offline-cache';
assert.equal(added.exitCode, 0, `Package installation failed; evidence retained at ${root}`);
const dependency = join(profile, 'node_modules/@qwqbig/dsh-archive-delete');
const manifest = JSON.parse(await readFile(join(dependency, 'package.json'), 'utf8'));
assert.equal(manifest.name, '@qwqbig/dsh-archive-delete');
// React is provided by the browser ModuleLoader, not by Node's package tree.
for (const name of Object.keys(manifest.peerDependencies).filter(name => name.startsWith('@deepseek-ai/'))) nativeRequire.resolve(name === '@deepseek-ai/node-addon-system' ? `${name}/flock` : name);
await access(join(dependency, 'lib/index.js')); assert.match(await readFile(join(dependency, 'lib/client.js'), 'utf8'), /window\.__ModuleLoader__\.load/);
// Import the packed host with normal Node resolution: no test hook supplies its peers.
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
