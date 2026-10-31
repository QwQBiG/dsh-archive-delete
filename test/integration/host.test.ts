import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { access, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { createRequire, registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import test, { type TestContext } from 'node:test';
import { acquirePluginLease, createDshAdapter, getNativeLockExclusive, getNativeWindowsLock, getStorageSources, getStorageWorkspaces, type HostContext } from '../../src/dsh-adapter.js';
import { ArchiveService } from '../../src/service.js';
import { TrashStore } from '../../src/storage.js';
import { registerHostRoutes } from '../../src/host-routes.js';
import { apply as applyPlugin } from '../../src/index.js';
import { PLUGIN_VERSION } from '../../src/version.js';
import type { JsonObject, StorageOverview } from '../../src/contracts.js';
import { PACKAGE_NAME, SUPPORTED_DSH_VERSION } from '../../src/contracts.js';
import { createUpdateHost } from '../../src/update-host.js';

const runtimeRoot = process.env.DSH_RUNTIME_ROOT ?? '/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh';
const hostRequire = createRequire(join(runtimeRoot, 'package.json'));
// Resolve production externals from the separately installed, exact native runtime.
let resolvingHost = false;
registerHooks({ resolve(specifier, context, next) {
  if (!resolvingHost && specifier.startsWith('@deepseek-ai/')) {
    resolvingHost = true;
    try { return { url: pathToFileURL(hostRequire.resolve(specifier)).href, shortCircuit: true }; } finally { resolvingHost = false; }
  }
  return next(specifier, context);
} });
const host = async (name: string): Promise<Record<string, any>> => import(name);
const { Context, Service } = await host('@deepseek-ai/cordis');
const { SessionStore, Session } = await host('@deepseek-ai/dsh-session');
const { AgentRegistry } = await host('@deepseek-ai/dsh-agent');
const { AgentLoop } = await host('@deepseek-ai/dsh-agent-loop');
const { createUserMessage } = await host('@deepseek-ai/dsh-llm');
const { DomainFacility } = await host('@deepseek-ai/dsh-storage-domain');
const { JsonStorageBackend } = await host('@deepseek-ai/dsh-storage-json');
const { SessionProjectionRegistry } = await host('@deepseek-ai/dsh-session-projection');
const { titleProjectionDefinition } = await host('@deepseek-ai/dsh-session-title');
const { SessionProjectionCache, projectionCacheDomainSpec } = await host('@deepseek-ai/dsh-session-projection-cache');
const { WorkspaceRegistry } = await host('@deepseek-ai/dsh-workspace');
const jsonl = await host('@deepseek-ai/dsh-session-persistence-jsonl');
const { HostConnectionService } = await host('@deepseek-ai/dsh-client-connection');

async function fixture(t: TestContext, compression = 'none') {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'archive-native-')));
  const project = join(home, 'project'); await mkdir(project);
  const sessionsRoot = join(home, 'sessions'); await mkdir(sessionsRoot);
  const ctx = new Context();
  ctx.provide('profileContext', { installAnchor: join(runtimeRoot, 'node_modules/@deepseek-ai/dsh/package.json') });
  const backend = new JsonStorageBackend(join(home, 'storage'));
  ctx.provide('storage', { backend: { get: () => backend } });
  const domains = new DomainFacility(ctx, { backend: 'json' }); ctx.provide('storageDomain', domains);
  const sessions = new SessionStore(ctx);
  const projections = new SessionProjectionRegistry(ctx); projections.register(titleProjectionDefinition);
  const cache = new SessionProjectionCache(ctx, { writeEveryEvents: 200, writeIntervalMs: 5000 }); await cache[Service.init]();
  await jsonl.apply(ctx, { root: sessionsRoot, compression });
  const persistence = ctx.get('sessionPersistence');
  const registry = new WorkspaceRegistry(ctx); await registry[Service.init]();
  const workspace = await registry.create(project, 'Synthetic project');
  const adapter = await createDshAdapter(ctx as HostContext, { home });
  const store = new TrashStore({ root: join(home, 'archive-delete'), sessionsRoot });
  const api = new ArchiveService(adapter, store); await api.initialize();
  t.after(async () => { await api.close(); await domains.closeAll(); await backend.close(); await rm(home, { recursive: true, force: true }); });
  async function create(id: string, title = `Title ${id}`, meta: JsonObject = {}, seed?: unknown[], inheritedEventCount = 0) {
    const prepared = sessions.prepare(id, { meta: { cwd: project, createdAt: 1000, ...meta }, ...(seed ? { seed, inheritedEventCount } : {}) });
    const writer = await persistence.create(prepared.header, { inheritedEventCount });
    const events = seed ?? [{ type: 'session/title', seq: 0, time: 1001, data: { title, messageSeqs: [], source: { kind: 'user' } } }];
    await writer.append(events); await writer.flush(); await writer.close();
    await registry.indexHeader(prepared.header); await workspace.attachSession(id); await registry.archiveSession(id);
    const reader = await persistence.open(id, 'read');
    try {
      const { events: restoredEvents } = await reader.read();
      const restored = projections.restore({}, restoredEvents, 0, reader.header, reader.inheritedEventCount);
      await cache.put(id, { formatVersion: reader.header.version, createdAt: reader.header.createdAt, cwd: reader.header.cwd, isSeeded: reader.header.isSeeded, inheritedEventCount: reader.inheritedEventCount }, restored.checkpoint);
    } finally { await reader.close(); }
    return prepared;
  }
  async function execute(action: 'trash' | 'restore' | 'purge', ids: string[]) {
    const preview = await api.preview(action, ids);
    return api.execute(preview.id, randomUUID());
  }
  return { home, project, ctx, sessions, persistence, registry, cache, domains, workspace, adapter, store, api, create, execute };
}

test('stock rc.3: true JSONL and registry trash/restore/purge, official title survives domain reopen', async t => {
  const f = await fixture(t); const parent = await f.create('native-parent', 'Native synthetic title');
  assert.equal((await f.adapter.capabilities()).supported, true);
  assert.equal(f.persistence.name, 'session-persistence-jsonl');
  assert.equal((await f.api.list()).archived[0]!.title, 'Native synthetic title');
  const group = await f.adapter.inspect(parent.id);
  const original = await readFile(join(group.members[0]!.directory, 'session.v4.jsonl'));
  assert.equal((await f.execute('trash', [parent.id])).items[0]!.status, 'moved');
  assert.equal(await f.persistence.stat(parent.id), undefined);
  assert.equal(f.registry.headers.has(parent.id), false);
  assert.equal(f.cache.cachedSnapshot(parent.header), undefined);
  const trash = (await f.api.list()).trash[0]!;
  assert.equal((await f.execute('restore', [trash.id])).items[0]!.status, 'restored');
  assert.deepEqual(await readFile(join(group.members[0]!.directory, 'session.v4.jsonl')), original);
  assert.ok(f.registry.archivedSessionIds.includes(parent.id));
  assert.ok(f.workspace.record.sessionIds.includes(parent.id));
  assert.equal(f.cache.cachedSnapshot(parent.header).values.title, 'Native synthetic title');
  await f.create('permanent-target');
  assert.equal((await f.execute('trash', ['permanent-target'])).items[0]!.status, 'moved');
  const again = (await f.api.list()).trash[0]!;
  assert.equal((await f.execute('purge', [again.id])).items[0]!.status, 'purged');
  assert.equal((await f.api.list()).trash.length, 0);
  await f.domains.get(projectionCacheDomainSpec.name).close();
  const reopened = await f.domains.open(projectionCacheDomainSpec);
  assert.equal(reopened.table('sessions').get(parent.id).rows.title.val, 'Native synthetic title');

});

test('stock rc.3: native independent fork retains its inherited log after parent and subagent trash', async t => {
  const f = await fixture(t); const parent = await f.create('fork-source', 'Copied title');
  const reader = await f.persistence.open(parent.id, 'read'); const { events } = await reader.read(); await reader.close();
  const forkContext = new Context(); const forkStore = new SessionStore(forkContext);
  const source = forkStore.prepare(parent.id, { seed: events, meta: parent.header }); forkStore.enter(source);
  const fork = forkStore.fork(source, undefined, 'independent-fork');
  assert.equal(fork.header.origin, undefined); assert.equal(fork.header.isSeeded, true);
  await f.create(fork.id, '', fork.header, fork.snapshotEvents(), fork.inheritedEventCount);
  await f.create('dedicated-child', 'Child', { parentSession: parent.id, origin: 'subagent' });
  const group = await f.adapter.inspect(parent.id); assert.deepEqual(group.members.map(m => m.id), [parent.id, 'dedicated-child']);
  assert.equal((await f.execute('trash', [parent.id])).items[0]!.status, 'moved');
  assert.equal(await f.persistence.stat('dedicated-child'), undefined);
  const forkReader = await f.persistence.open(fork.id, 'read');
  try {
    const actual = await forkReader.read();
    const restored = Session.fromRestore(fork.id, actual.events, forkReader.header, forkReader.inheritedEventCount, actual.eventState);
    assert.deepEqual(restored.snapshotEvents(), fork.snapshotEvents());
    assert.equal(restored.inheritedEventCount, fork.inheritedEventCount);
  } finally { await forkReader.close(); }
});

test('stock rc.3: native Connection keeps plugin route behind owner admission', async t => {
  const f = await fixture(t); await f.create('gateway');
  const connection = new HostConnectionService(f.ctx, ['127.0.0.1'], { isAuthenticated: (request: Request) => request.headers.get('cookie') === 'synthetic=owner', authenticateApi: () => undefined });
  const unmount = registerHostRoutes(f.ctx as HostContext, f.api); t.after(unmount);
  const request = (cookie = '') => new Request('http://127.0.0.1/api/dsh-archive-delete', { method: 'POST', headers: { host: '127.0.0.1', 'content-type': 'application/json', cookie }, body: JSON.stringify({ action: 'list' }) });
  assert.equal(connection.requestRejection(request()), 401);
  assert.equal(connection.requestRejection(request('synthetic=owner')), undefined);
  const gateway = connection.createSharedFetchHandler('/api');
  assert.equal((await gateway.fetch(request(), { principal: { kind: 'tool' } })).status, 403);
  const response = await gateway.fetch(request('synthetic=owner'), connection.browserPeer);
  assert.equal(response.status, 200); assert.equal((await response.json()).value.archived[0].id, 'gateway');
});

test('stock rc.3: native storage owners and authenticated read-only overview use their real configured roots', async t => {
  const f = await fixture(t); await f.create('storage-native'); f.ctx.provide('dshHomePath', () => f.home);
  const { LocalAttachmentStore } = await host('@deepseek-ai/dsh-attachment-local');
  const { LocalSpillStore } = await host('@deepseek-ai/dsh-spill-local');
  const { SqliteSessionQueryEngine } = await host('@deepseek-ai/dsh-session-query-sqlite');
  const attachments = new LocalAttachmentStore(f.ctx, { dshHome: f.home });
  // Disable the SDK's cleanup discovery so this test can touch only its fixture.
  const spill = new LocalSpillStore(f.ctx, { root: join(f.home, 'synthetic-spill'), cleanupPeriodDays: 0 });
  const query = new SqliteSessionQueryEngine(f.ctx, { path: ':memory:', openAt: 'never' }); await query[Service.init]();
  const attachmentBytes = Buffer.from('Synthetic shared attachment');
  const attachment = await attachments.saveFile({ name: 'first.txt', data: attachmentBytes });
  await attachments.saveFile({ name: 'second.txt', data: attachmentBytes });
  await mkdir(attachments.cacheRoot, { recursive: true }); await writeFile(join(attachments.cacheRoot, 'synthetic-cache'), Buffer.alloc(7));
  await writeFile(join(f.home, 'cache', 'unrelated-cache'), Buffer.alloc(5));
  const spilled = await spill.saveText({ owner: { sessionId: 'storage-native' }, suggestedName: 'output.txt', content: 'Synthetic spill' });
  await mkdir(join(f.project, 'nested')); await writeFile(join(f.project, 'AI-final.tmp'), Buffer.alloc(23));
  await writeFile(join(f.project, 'nested', 'output.bin'), Buffer.alloc(12));
  const otherProject = join(f.home, 'other-project'); await mkdir(otherProject); await writeFile(join(otherProject, 'unselected.bin'), Buffer.alloc(99));
  const otherWorkspace = await f.registry.create(otherProject, 'Other synthetic project');
  const roots = await getStorageSources(f.ctx as HostContext); const byId = new Map(roots.map(root => [root.id, root]));
  assert.equal(byId.get('sessions')?.path, f.persistence.root);
  assert.equal(byId.get('attachments')?.path, attachments.root); assert.equal(byId.get('attachment-cache')?.path, attachments.cacheRoot);
  assert.equal(byId.get('settings')?.path, f.ctx.get('storage').backend.get('json').root);
  assert.equal(byId.get('spill')?.path, spill.root); assert.equal(byId.get('search')?.unavailableReason, 'in-memory');
  assert.deepEqual(getStorageWorkspaces(f.ctx as HostContext).map(workspace => workspace.id).sort(), [f.workspace.id, otherWorkspace.id].sort());
  assert.ok(byId.get('other')?.excludePaths?.includes(f.project)); assert.ok(byId.get('other')?.excludePaths?.includes(otherProject));
  const registryBefore = JSON.stringify(f.registry.requireState());
  const session = (await f.adapter.inspect('storage-native')).members[0]!;
  const sessionBytes = await readFile(join(session.directory, 'session.v4.jsonl'));
  const connection = new HostConnectionService(f.ctx, ['127.0.0.1'], { isAuthenticated: (request: Request) => request.headers.get('cookie') === 'synthetic=owner', authenticateApi: () => undefined });
  const close = await applyPlugin(f.ctx as HostContext);
  try {
    const gateway = connection.createSharedFetchHandler('/api');
    const request = (body: unknown, signal?: AbortSignal) => new Request('http://127.0.0.1/api/dsh-archive-delete', {
      method: 'POST', headers: { host: '127.0.0.1', cookie: 'synthetic=owner', 'content-type': 'application/json' }, body: JSON.stringify(body), ...(signal ? { signal } : {}),
    });
    const read = async (body: unknown): Promise<StorageOverview> => {
      const response = await gateway.fetch(request(body), connection.browserPeer); assert.equal(response.status, 200);
      const payload = await response.json() as { ok: boolean; value: StorageOverview }; assert.equal(payload.ok, true); return payload.value;
    };
    assert.equal(connection.requestRejection(request({ action: 'storage' })), undefined);
    assert.equal((await gateway.fetch(request({ action: 'storage' }), { principal: { kind: 'tool' } })).status, 403);
    const hostUsage = await read({ action: 'storage' });
    const category = (kind: string) => hostUsage.categories.find(item => item.kind === kind)!;
    assert.equal(category('attachments').status, 'complete'); assert.equal(category('attachments').fileBytes, attachmentBytes.length);
    assert.equal(category('attachments').referencedBytes, attachmentBytes.length * 3); assert.equal(category('attachments').counters.duplicateHardlinks, 2);
    assert.equal(category('attachment-cache').fileBytes, 7); assert.equal(category('cache').fileBytes, 5);
    assert.ok(category('settings').fileBytes! > 0); assert.equal(category('spill').fileBytes, spilled.bytes);
    assert.equal(category('search').status, 'unavailable'); assert.equal(category('search').fileBytes, null); assert.equal(query._db, undefined);
    assert.ok(hostUsage.categories.every(item => item.largestFiles.every(file => !file.relativePath.includes('unselected.bin') && !file.relativePath.includes('AI-final.tmp'))));
    const selected = await read({ action: 'storage', workspaceId: f.workspace.id });
    assert.equal(selected.scope, 'workspace'); assert.equal(selected.workspaceId, f.workspace.id); assert.equal(selected.complete, true);
    assert.equal(selected.fileBytes, 35); assert.equal(selected.fileCount, 2); assert.equal(selected.categories.length, 1);
    assert.deepEqual(selected.categories[0]!.largestFiles.map(file => [file.relativePath, file.source]), [['AI-final.tmp', 'unknown'], ['nested/output.bin', 'unknown']]);
    assert.equal(JSON.stringify(selected).includes(f.home), false);
    const rejected = await gateway.fetch(request({ action: 'storage', workspaceId: f.workspace.id, path: otherProject }), connection.browserPeer);
    assert.equal(rejected.status, 400); assert.equal((await rejected.json()).error.code, 'invalid-request');
    const controller = new AbortController(); const pending = gateway.fetch(request({ action: 'storage', workspaceId: f.workspace.id }, controller.signal), connection.browserPeer);
    controller.abort(); const cancelled = await pending;
    assert.equal(cancelled.status, 409); assert.equal((await cancelled.json()).error.code, 'scan-cancelled');
    assert.equal((await read({ action: 'storage', workspaceId: f.workspace.id })).fileBytes, 35);
    assert.equal(JSON.stringify(f.registry.requireState()), registryBefore); assert.equal(query._db, undefined);
    assert.deepEqual(await readFile(join(session.directory, 'session.v4.jsonl')), sessionBytes);
    assert.deepEqual(await readFile(attachments.fileHostPath(attachment)), attachmentBytes);
    assert.equal(await readFile(spilled.locator, 'utf8'), 'Synthetic spill');
    assert.equal((await lstat(join(otherProject, 'unselected.bin'))).size, 99);
    assert.deepEqual((await readdir(f.project)).sort(), ['AI-final.tmp', 'nested']);
  } finally { await close(); await query.close(); }
});

test('stock rc.3: relocated session leases exclude native writers without obstructing rename', async t => {
  const f = await fixture(t); await f.create('leased');
  const group = await f.adapter.inspect('leased');
  const held = await f.adapter.acquire(group); assert.equal(held.kind, 'acquired'); if (held.kind !== 'acquired') return;
  const source = group.members[0]!.directory; const relocated = join(f.home, 'relocated');
  const flockPath = hostRequire.resolve('@deepseek-ai/node-addon-system/flock');
  const posixProbe = `import {open} from 'node:fs/promises';import {tryLockExclusive} from ${JSON.stringify(pathToFileURL(flockPath).href)};const handle=await open(process.argv[1],'r+');try{await tryLockExclusive(handle.fd);process.exitCode=9}catch(e){if(e.code!=='EAGAIN'&&e.code!=='EWOULDBLOCK')throw e}finally{await handle.close()}`;
  const windowsProbe = `import {Context} from ${JSON.stringify(pathToFileURL(hostRequire.resolve('@deepseek-ai/cordis')).href)};import {SessionStore} from ${JSON.stringify(pathToFileURL(hostRequire.resolve('@deepseek-ai/dsh-session')).href)};import {apply} from ${JSON.stringify(pathToFileURL(hostRequire.resolve('@deepseek-ai/dsh-session-persistence-jsonl')).href)};const ctx=new Context();new SessionStore(ctx);await apply(ctx,{root:process.argv[2],compression:'none'});try{const lease=await ctx.get('sessionPersistence').acquireLease('probe',undefined,process.argv[1]);await lease.release();process.exitCode=9}catch(e){if(e.name!=='SessionAlreadyOwnedError')throw e}`;
  const run = (script: string, filename: string) => new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, filename, join(f.home, 'sessions')], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = ''; child.stderr.on('data', chunk => { stderr += String(chunk); }); child.on('error', reject);
    child.on('exit', status => status === 0 ? resolve() : reject(new Error(`foreign native lock probe: ${status}: ${stderr}`)));
  });
  try {
    if (process.platform === 'win32') { await run(windowsProbe, source.toUpperCase()); await assert.rejects(access(join(source, 'session.lock')), { code: 'ENOENT' }); }
    await rename(source, relocated);
    if (process.platform === 'win32') {
      // A native contender may mkdir its absent destination before the semaphore refuses it.
      await run(windowsProbe, source); assert.deepEqual(await readdir(source), []); await rmdir(source);
    } else await run(posixProbe, join(relocated, 'session.lock'));
    const second = await f.adapter.acquireLocated(group, [relocated]); assert.equal(second.kind, 'busy');
    const pluginLease = await acquirePluginLease(join(f.home, 'archive-delete'), getNativeLockExclusive(f.ctx), { lockNamed: getNativeWindowsLock(f.ctx) });
    try {
      if (process.platform !== 'win32') await run(posixProbe, join(f.home, 'archive-delete', '.lock'));
      await assert.rejects(acquirePluginLease(join(f.home, 'archive-delete'), getNativeLockExclusive(f.ctx), { lockNamed: getNativeWindowsLock(f.ctx) }), { code: 'store-busy' });
    } finally { await pluginLease.release(); }
  } finally { await held.lease.release(); }
  const available = await f.adapter.acquireLocated(group, [relocated]); assert.equal(available.kind, 'acquired'); if (available.kind !== 'acquired') return;
  try {
    if (process.platform === 'win32') { await run(windowsProbe, source); await run(windowsProbe, relocated); }
  } finally { await available.lease.release(); }
});

test('stock rc.3: own loaded JSONL writer queues, cancellation persists, next startup replays once', async t => {
  const f = await fixture(t); const prepared = await f.create('pending-native');
  const detach = f.sessions.enter(prepared); const writer = await f.persistence.open(prepared.id, 'write');
  assert.equal((await f.execute('trash', [prepared.id])).items[0]!.status, 'pending');
  assert.equal((await f.api.list()).archived[0]!.pending, true);
  assert.equal((await f.api.cancelPending([prepared.id], randomUUID())).items[0]!.status, 'cancelled');
  assert.equal((await f.api.list()).archived[0]!.pending, undefined);
  assert.equal((await f.execute('trash', [prepared.id])).items[0]!.status, 'pending');
  await writer.close(); detach(); await f.api.close();
  const restarted = new ArchiveService(f.adapter, new TrashStore({ root: join(f.home, 'archive-delete'), sessionsRoot: join(f.home, 'sessions') }));
  t.after(() => restarted.close()); await restarted.initialize();
  assert.equal((await restarted.list()).trash.length, 1);
  assert.equal((await restarted.list()).archived.length, 0);
  await restarted.initialize(); assert.equal((await restarted.list()).trash.length, 1);
});

test('stock rc.3: official Agent activity provider blocks turns awaiting user interaction', async t => {
  const f = await fixture(t); const prepared = await f.create('interaction-native');
  const { AgentRegistry } = await host('@deepseek-ai/dsh-agent'); const agents = new AgentRegistry(f.ctx);
  // This provider's official contract keeps approval/question waits in status=running.
  // Supply that native boundary state without initiating any model or real interaction.
  agents.store.set(prepared.id, { agent: { status: 'running' } });
  assert.equal((await f.adapter.inspect(prepared.id)).members[0]!.activity[0]!.kind, 'turn');
  const blocked = await f.api.preview('trash', [prepared.id]);
  assert.equal(blocked.items[0]!.disposition, 'blocked'); assert.equal(blocked.items[0]!.code, 'active');
  agents.store.delete(prepared.id);
});

test('stock rc.3: default zstd JSONL moves and restores without changing compressed bytes', async t => {
  const f = await fixture(t, 'zstd'); const prepared = await f.create('default-compressed');
  const member = (await f.adapter.inspect(prepared.id)).members[0]!;
  const file = join(member.directory, 'session.v4.jsonl.zstd'); const original = await readFile(file);
  assert.equal((await f.execute('trash', [prepared.id])).items[0]!.status, 'moved');
  const entry = (await f.api.list()).trash[0]!;
  assert.equal((await f.execute('restore', [entry.id])).items[0]!.status, 'restored');
  assert.deepEqual(await readFile(file), original);
});

test('runtime version comes from the live profile installation, independent of pinned plugin peers', async t => {
  const f = await fixture(t);
  const anchor = join(f.home, 'other-runtime-package.json');
  const { writeFile } = await import('node:fs/promises');
  await writeFile(anchor, JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.3.0' }));
  const context: HostContext = { ...f.ctx, get: (name: string) => name === 'profileContext' ? { installAnchor: anchor } : f.ctx.get(name) };
  const other = await createDshAdapter(context, { home: f.home });
  assert.equal((await other.capabilities()).version, '0.3.0');
  assert.equal((await other.capabilities()).supported, false);
  const absent = await createDshAdapter({ get: name => name === 'profileContext' ? undefined : f.ctx.get(name) }, { home: f.home });
  assert.equal((await absent.capabilities()).version, 'unknown');
  assert.equal((await absent.capabilities()).supported, false);
});

test('a second plugin instance obtains no data areas before the native store lease', async t => {
  const f = await fixture(t); const home = join(f.home, 'second-instance-home'); await mkdir(home);
  const root = join(home, 'archive-delete');
  const held = await acquirePluginLease(root, getNativeLockExclusive(f.ctx), { lockNamed: getNativeWindowsLock(f.ctx) });
  t.after(() => held.release());
  const warnings: string[] = [];
  const close = await applyPlugin({ get: name => f.ctx.get(name), dshHomePath: () => home,
    waterfall: (event, request, next) => f.ctx.waterfall(event, request, next), emit: (event, ...args) => f.ctx.emit(event, ...args),
    logger: { warn: message => warnings.push(message) },
    connection: { fetch: { register: () => () => {} } },
  });
  t.after(close);
  assert.ok(warnings.some(message => message.includes('Another DSH process owns')));
  for (const area of ['trash', 'staging', 'operations', 'receipts']) await assert.rejects(access(join(root, area)), { code: 'ENOENT' });
});

test('successful startup logs its installed version and active API only after route admission; a failed mount never logs loaded', async t => {
  const f = await fixture(t);
  const info: string[] = []; const warnings: string[] = [];
  const connection = new HostConnectionService(f.ctx, ['127.0.0.1'], { isAuthenticated: () => true, authenticateApi: () => undefined });
  const common: HostContext = { get: name => f.ctx.get(name), dshHomePath: () => f.home,
    waterfall: (event, request, next) => f.ctx.waterfall(event, request, next), emit: (event, ...args) => f.ctx.emit(event, ...args),
    logger: { warn: message => warnings.push(message), info: message => info.push(message) },
  };
  const failed = await applyPlugin({ ...common, get: name => name === 'connection' ? { fetch: { register: () => { throw new Error('synthetic route mount failure'); } } } : f.ctx.get(name) });
  await failed();
  assert.equal(info.length, 0);
  assert.ok(warnings.some(message => message.includes('could not be registered')));
  // A new mount also proves the failed attempt released its exclusive store lease.
  const close = await applyPlugin(common);
  try {
    assert.equal(info.length, 1);
    assert.ok(info[0]!.startsWith(`[archive-delete] v${PLUGIN_VERSION} loaded`));
    assert.match(info[0]!, /target DSH 0\.2\.1-rc\.3 \(host 0\.2\.1-rc\.3\)/);
    assert.ok(info[0]!.includes(JSON.stringify(join(f.home, 'archive-delete', 'trash'))));
    const response = await connection.createSharedFetchHandler('/api').fetch(new Request('http://127.0.0.1/api/dsh-archive-delete', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'list' }),
    }), connection.browserPeer);
    const result = await response.json() as { ok: boolean; value: { support: { supported: boolean } } };
    assert.equal(result.ok, true); assert.equal(result.value.support.supported, true);
  } finally { await close(); }
});

test('stock rc.3: explicit partial-purge retry locks the remaining member with preserved slot identity', async t => {
  const f = await fixture(t); await f.create('partial-parent');
  await f.create('partial-child', 'Child', { parentSession: 'partial-parent', origin: 'subagent' });
  assert.equal((await f.execute('trash', ['partial-parent'])).items[0]!.status, 'moved');
  const entry = (await f.api.list()).trash[0]!;
  const { readdir, rmdir, unlink } = await import('node:fs/promises');
  const removedMember = join(f.home, 'archive-delete', 'trash', entry.id, '0');
  const manifest = await f.store.manifest(entry.id);
  const operation = { schema: 1, id: randomUUID(), entryId: entry.id, phase: 'purging', group: manifest.group, createdAt: Date.now(), moved: [] };
  await writeFile(join(f.store.root, 'operations', `${operation.id}.json`), JSON.stringify(operation), { mode: 0o600 });
  // A real purge persists its journal before removing the first member.
  for (const filename of await readdir(removedMember)) await unlink(join(removedMember, filename));
  await rmdir(removedMember);
  const locations = await f.store.entryLocations(entry.id);
  assert.equal(locations.length, 2); assert.equal(locations[0], undefined);
  const held = await f.adapter.acquireLocated(manifest.group, locations); assert.equal(held.kind, 'acquired');
  if (held.kind !== 'acquired') return;
  try { assert.equal((await f.adapter.acquireLocated(manifest.group, locations)).kind, 'busy'); }
  finally { await held.lease.release(); }
  const restore = await f.api.preview('restore', [entry.id]); assert.equal(restore.items[0]!.disposition, 'blocked');
  const purge = await f.api.preview('purge', [entry.id]);
  const remainingBytes = (await lstat(join(locations[1]!, 'session.v4.jsonl'))).size;
  assert.equal(purge.items[0]!.sizeBytes, remainingBytes); assert.ok(remainingBytes < entry.sizeBytes);
  assert.equal((await f.api.execute(purge.id, randomUUID())).items[0]!.status, 'purged');
  assert.equal((await f.api.list()).trash.length, 0);
});

test('stock rc.3: startup rolls back a detached but uncommitted move under native leases', async t => {
  const f = await fixture(t); await f.create('interrupted-parent', 'Recovered title');
  await f.create('interrupted-child', 'Recovered child', { parentSession: 'interrupted-parent', origin: 'subagent' });
  const group = await f.adapter.inspect('interrupted-parent');
  const held = await f.adapter.acquire(group); assert.equal(held.kind, 'acquired'); if (held.kind !== 'acquired') return;
  try {
    const op = await f.store.prepareTrash(group); await f.adapter.removeRegistry(group); await f.store.markDetached(op);
    // End this process's critical section at the same durable point a crash leaves behind.
  } finally { await held.lease.release(); }
  await f.api.close();
  const restarted = new ArchiveService(f.adapter, new TrashStore({ root: join(f.home, 'archive-delete'), sessionsRoot: join(f.home, 'sessions') }));
  t.after(() => restarted.close()); await restarted.initialize();
  assert.equal((await restarted.list()).trash.length, 0);
  assert.equal((await restarted.list()).archived[0]!.title, 'Recovered title');
  for (const member of group.members) { assert.ok(await f.persistence.stat(member.id)); assert.ok(f.workspace.record.sessionIds.includes(member.id)); }
  assert.equal((await f.store.operations()).length, 0);
  await restarted.initialize(); assert.equal((await restarted.list()).archived.length, 1);
});

test('Windows: another process owns the plugin semaphore until process death', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t);
  const adapterFile = new URL('../../src/dsh-adapter.ts', import.meta.url).href;
  const script = `import {acquirePluginLease,getNativeLockExclusive,getNativeWindowsLock} from ${JSON.stringify(adapterFile)};const ctx={profileContext:{installAnchor:process.argv[2]}};await acquirePluginLease(process.argv[1],getNativeLockExclusive(ctx),{lockNamed:getNativeWindowsLock(ctx)});process.stdout.write('owned\\n');setInterval(()=>{},10000)`;
  const child = spawn(process.execPath, ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href, '--input-type=module', '-e', script, join(f.home, 'archive-delete'), join(runtimeRoot, 'node_modules/@deepseek-ai/dsh/package.json')], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', chunk => { stderr += String(chunk); });
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exited; });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`foreign semaphore owner did not start: ${stderr}`)), 15000);
    child.stdout.once('data', () => { clearTimeout(timer); resolve(); }); child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(`foreign semaphore owner exited: ${stderr}`)); });
  });
  await assert.rejects(acquirePluginLease(join(f.home, 'archive-delete'), getNativeLockExclusive(f.ctx), { lockNamed: getNativeWindowsLock(f.ctx) }), { code: 'store-busy' });
  child.kill('SIGKILL'); await exited;
  const afterCrash = await acquirePluginLease(join(f.home, 'archive-delete'), getNativeLockExclusive(f.ctx), { lockNamed: getNativeWindowsLock(f.ctx) });
  await afterCrash.release();
});

/** Real factory ownership and real JSONL handles, without model/network calls. */
function managedAgents(f: Awaited<ReturnType<typeof fixture>>) {
  new AgentRegistry(f.ctx);
  f.ctx.provide('llm', {}); f.ctx.provide('tools', {}); f.ctx.provide('systemPrompt', { variable() {} });
  new AgentLoop(f.ctx, { agents: [], maxParallelToolCalls: 10 });
  const handles: any[] = [];
  return {
    async create(id: string, title: string, parent?: any) {
      const owner = parent?.ctx ?? f.ctx;
      const handle = await owner.agents.create({ sessionId: id, agentOptions: {},
        meta: { cwd: f.project, ...(parent ? { parentSession: parent.id, origin: 'subagent', delegationDepth: 1 } : {}) },
        ...(parent ? { parentAgent: parent } : {}) });
      handles.push(handle);
      handle.agent.session.append('session/title', { title, messageSeqs: [], source: { kind: 'user' } });
      await f.ctx.sessions.flush(handle.agent.session);
      await f.registry.indexHeader(handle.agent.session.header); await f.workspace.attachSession(id);
      if (!parent) await f.registry.archiveSession(id);
      return handle;
    },
    async resume(id: string, parent?: any) {
      const owner = parent?.ctx ?? f.ctx;
      const handle = await owner.agents.resume({ resumeSessionId: id, agentOptions: {}, ...(parent ? { parentAgent: parent } : {}) });
      handles.push(handle); return handle;
    },
    async close() { for (const handle of [...handles].reverse()) await handle.dispose(); },
  };
}

async function createIndependentFork(f: Awaited<ReturnType<typeof fixture>>, sourceId: string, id: string) {
  const reader = await f.persistence.open(sourceId, 'read');
  let events: unknown[]; let header: JsonObject;
  try { events = (await reader.read()).events; header = reader.header; } finally { await reader.close(); }
  const forkStore = new SessionStore(new Context());
  const source = forkStore.prepare(sourceId, { seed: events, meta: header }); const detach = forkStore.enter(source);
  try {
    const fork = forkStore.fork(source, undefined, id);
    await f.create(fork.id, '', fork.header, fork.snapshotEvents(), fork.inheritedEventCount);
  } finally { detach(); }
}

test('stock rc.3: managed idle parent and child move and purge in the same process without restarting', async t => {
  const f = await fixture(t);
  await f.create('hot-parent', 'Hot parent');
  await f.create('hot-child', 'Hot child', { parentSession: 'hot-parent', origin: 'subagent' });
  await createIndependentFork(f, 'hot-parent', 'hot-independent-fork');
  const fork = (await f.adapter.inspect('hot-independent-fork')).members[0]!;
  const forkFile = join(fork.directory, 'session.v4.jsonl'); const forkBytes = await readFile(forkFile);
  const managed = managedAgents(f);
  try {
    const parent = await managed.resume('hot-parent'); await managed.resume('hot-child', parent.agent);
    const preview = await f.api.preview('trash', ['hot-parent']);
    assert.deepEqual(preview.items[0]!.memberIds, ['hot-parent', 'hot-child']);
    const moved = await f.api.execute(preview.id, randomUUID());
    assert.equal(moved.items[0]!.status, 'moved', JSON.stringify(moved));
    assert.equal(f.ctx.agents.get('hot-parent'), undefined); assert.equal(f.ctx.sessions.get('hot-parent'), undefined);
    assert.equal(f.ctx.agents.get('hot-child'), undefined); assert.equal(f.ctx.sessions.get('hot-child'), undefined);
    assert.equal(await f.persistence.stat('hot-parent'), undefined); assert.equal(await f.persistence.stat('hot-child'), undefined);
    const entry = (await f.api.list()).trash[0]!;
    assert.equal((await f.execute('purge', [entry.id])).items[0]!.status, 'purged');
    assert.equal((await f.api.list()).trash.length, 0);
    assert.deepEqual(await readFile(forkFile), forkBytes);
    assert.ok(f.registry.archivedSessionIds.includes('hot-independent-fork'));
  } finally { await managed.close(); }
});

test('stock rc.3: newly created live sessions normalize the persisted default depth, then move and purge without restart', async t => {
  const f = await fixture(t); const managed = managedAgents(f);
  try {
    const parent = await managed.create('factory-new-parent', 'Factory new parent');
    const child = await managed.create('factory-new-child', 'Factory new child', parent.agent);
    const group = await f.adapter.inspect(parent.agent.id);
    assert.equal(Object.hasOwn(parent.agent.session.header, 'delegationDepth'), false);
    assert.equal(group.members[0]!.header.delegationDepth, 0);
    assert.equal(child.agent.session.header.delegationDepth, 1);
    assert.equal(f.ctx.sessions.get(parent.agent.id), parent.agent.session);
    assert.notEqual(JSON.stringify(parent.agent.session.header), JSON.stringify(group.members[0]!.header));
    await createIndependentFork(f, parent.agent.id, 'factory-new-independent-fork');
    const fork = (await f.adapter.inspect('factory-new-independent-fork')).members[0]!;
    const forkFile = join(fork.directory, 'session.v4.jsonl'); const forkBytes = await readFile(forkFile);
    const preview = await f.api.preview('trash', [parent.agent.id]);
    assert.deepEqual(preview.items[0]!.memberIds, ['factory-new-parent', 'factory-new-child']);
    const moved = await f.api.execute(preview.id, randomUUID());
    assert.equal(moved.items[0]!.status, 'moved', JSON.stringify(moved));
    assert.equal(f.ctx.agents.get(parent.agent.id), undefined); assert.equal(f.ctx.sessions.get(parent.agent.id), undefined);
    assert.equal(f.ctx.agents.get(child.agent.id), undefined); assert.equal(f.ctx.sessions.get(child.agent.id), undefined);
    const entry = (await f.api.list()).trash[0]!;
    assert.equal((await f.execute('purge', [entry.id])).items[0]!.status, 'purged');
    assert.equal((await f.api.list()).trash.length, 0);
    assert.deepEqual(await readFile(forkFile), forkBytes);
    assert.ok(f.registry.archivedSessionIds.includes('factory-new-independent-fork'));
  } finally { await managed.close(); }
});

test('stock rc.3: default-depth normalization does not accept a changed actual depth or other header metadata', async t => {
  const f = await fixture(t); const managed = managedAgents(f);
  try {
    const parent = await managed.create('factory-new-protected', 'Factory protected');
    for (const field of ['delegationDepth', 'cwd', 'createdAt', 'isSeeded'] as const) {
      const group = await f.adapter.inspect(parent.agent.id); const header = group.members[0]!.header;
      if (field === 'delegationDepth') header.delegationDepth = 1;
      else if (field === 'cwd') header.cwd = join(f.home, 'different-project');
      else if (field === 'createdAt') header.createdAt = Number(header.createdAt) + 1;
      else header.isSeeded = true;
      await assert.rejects(f.adapter.releaseIdle!(group), { code: 'source-changed' });
      assert.equal(f.ctx.agents.get(parent.agent.id), parent.agent);
      assert.equal(f.ctx.sessions.get(parent.agent.id), parent.agent.session);
    }
    assert.ok(await f.persistence.stat(parent.agent.id));
  } finally { await managed.close(); }
});

test('stock rc.3: idle status during maintenance and a queued inbox never authorize lifecycle release', async t => {
  const f = await fixture(t); await f.create('hot-protected');
  const managed = managedAgents(f);
  let endMaintenance = () => {};
  const barrier = new Promise<void>(resolve => { endMaintenance = resolve; });
  let maintenance: Promise<unknown> | undefined;
  try {
    const handle = await managed.resume('hot-protected');
    maintenance = handle.agent.runMaintenance(() => barrier);
    assert.equal(handle.agent.status, 'idle'); assert.equal(handle.agent.phase.kind, 'maintenance');
    await assert.rejects(f.adapter.releaseIdle!((await f.adapter.inspect('hot-protected'))), { code: 'active' });
    assert.equal(f.ctx.agents.get('hot-protected'), handle.agent);
    endMaintenance(); await maintenance; maintenance = undefined;
    handle.agent.inject(createUserMessage({ content: [{ type: 'text', text: 'Synthetic queued input' }], source: { kind: 'user' } }));
    await f.ctx.sessions.flush(handle.agent.session);
    const member = (await f.adapter.inspect('hot-protected')).members[0]!;
    const file = join(member.directory, 'session.v4.jsonl'); const before = await readFile(file);
    await assert.rejects(f.adapter.releaseIdle!((await f.adapter.inspect('hot-protected'))), { code: 'active' });
    assert.equal(handle.agent.inbox.hasPending, true);
    assert.deepEqual(await readFile(file), before); assert.equal(f.ctx.sessions.get('hot-protected'), handle.agent.session);
  } finally { endMaintenance(); await maintenance; await managed.close(); }
});

test('stock rc.3: runtime child outside the confirmed group and duplicate owner effects fail closed', async t => {
  const f = await fixture(t); await f.create('hot-owner');
  await createIndependentFork(f, 'hot-owner', 'hot-outside-fork');
  const managed = managedAgents(f);
  let duplicate: (() => unknown) | undefined;
  try {
    const parent = await managed.resume('hot-owner'); await managed.resume('hot-outside-fork', parent.agent);
    const group = await f.adapter.inspect('hot-owner'); assert.deepEqual(group.members.map(member => member.id), ['hot-owner']);
    await assert.rejects(f.adapter.releaseIdle!(group), { code: 'ambiguous-lineage' });
    assert.equal(f.ctx.agents.get('hot-owner'), parent.agent);
    // A second unrelated ownership claim must not make the adapter guess which disposer to call.
    await managed.close();
    const root = await managed.resume('hot-owner');
    duplicate = f.ctx.effect(() => () => {}, 'agentLoop.lifecycle(hot-owner)');
    await assert.rejects(f.adapter.releaseIdle!((await f.adapter.inspect('hot-owner'))), { code: 'ambiguous-lifecycle' });
    assert.equal(f.ctx.agents.get('hot-owner'), root.agent);
  } finally { await duplicate?.(); await managed.close(); }
});

async function updateManagerFixture(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'archive-native-update-')));
  const home = join(root, 'home'); const dir = join(home, 'profiles', 'updater-qa');
  const packages = join(home, 'archive-delete', 'updates', 'packages'); await mkdir(packages, { recursive: true }); await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'synthetic-updater-profile', private: true, dependencies: {}, dsh: { profile: { bundles: [] } } }));
  await writeFile(join(dir, 'cordis.patch.yml'), '[]\n');
  const candidates = [process.env.DSH_PNPM_CLI, process.env.npm_execpath,
    '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.cjs'];
  let cli: string | undefined;
  for (const path of candidates) if (path && /\.[cm]?js$/i.test(path)) {
    try { await access(path); cli = path; break; } catch { /* Try the next explicit JavaScript entry. */ }
  }
  if (!cli) throw new Error('Set DSH_PNPM_CLI to the pnpm JavaScript entry for native tests.');
  // Windows .cmd launchers cannot be invoked through execFile without a shell.
  const command = process.execPath; const args = [cli];
  const env = { ...process.env, npm_config_offline: 'true', npm_config_registry: 'http://127.0.0.1:9',
    npm_config_manage_package_manager_versions: 'false', PNPM_OFFLINE: 'true' };
  const profile = { name: 'updater-qa', home, dir, patchPath: join(dir, 'cordis.patch.yml'), cwd: root,
    installAnchor: join(runtimeRoot, 'node_modules/@deepseek-ai/dsh/package.json'), startedBundles: [] as string[], overlays: [],
    packageManager: { command, args, env } };
  const ctx = new Context(); ctx.provide('profileContext', profile);
  const { default: Loader } = await host('@deepseek-ai/cordis-plugin-loader'); await ctx.plugin(Loader);
  const { PluginManager } = await host('@deepseek-ai/dsh-plugin-manager');
  const manager = new PluginManager(ctx, PluginManager.Config({ fallbackRegistries: [], inspectTimeoutMs: 1000, idleTimeoutMs: 15_000, lockWaitMs: 5000 }));
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); });
  async function pack(version: string, bundle = true) {
    const source = join(root, `source-${version}`); await mkdir(join(source, 'lib'), { recursive: true });
    await writeFile(join(source, 'package.json'), JSON.stringify({ name: PACKAGE_NAME, version, type: 'module', main: './lib/index.js', license: 'Apache-2.0',
      engines: { node: '>=24', dsh: SUPPORTED_DSH_VERSION }, ...(bundle ? { dsh: { manifestVersion: 1, bundle: { patch: './cordis.patch.yml' } } } : {}) }));
    await writeFile(join(source, 'cordis.patch.yml'), '[]\n');
    await writeFile(join(source, 'lib', 'index.js'), `export const name = 'synthetic-updater'; export const version = '${version}';`);
    await writeFile(join(source, 'lib', 'client.js'), '/* synthetic updater fixture */');
    await promisify(execFile)(command, [...args, 'pack', '--pack-destination', source], { cwd: source, env });
    const filename = (await readdir(source)).find(name => name.endsWith('.tgz')); assert.ok(filename);
    const bytes = await readFile(join(source, filename));
    const path = join(packages, `${version}-${createHash('sha256').update(bytes).digest('hex')}.tgz`); await writeFile(path, bytes, { mode: 0o600 });
    return path;
  }
  return { root, home, dir, profile, ctx, manager, pack };
}

test('stock rc.3 native manager: a persistent packed update replaces only the isolated profile and requires restart without HMR', async t => {
  const f = await updateManagerFixture(t); const old = await f.pack('0.0.1'); const next = await f.pack('0.0.2');
  const first = await f.manager.installBundle(old, { requestId: randomUUID(), enabled: true, saveExact: true });
  assert.equal(first.error, undefined, JSON.stringify(first)); assert.equal(first.application, 'restart-required');
  const adapter = await createUpdateHost(f.ctx as HostContext);
  assert.equal((await adapter.installed()).version, '0.0.1'); assert.equal(adapter.canInstall, true);
  assert.equal(adapter.loadedVersion, PLUGIN_VERSION);
  const outcome = await adapter.install(next, '0.0.2', randomUUID());
  assert.deepEqual(outcome, { status: 'restart-required' });
  const after = await adapter.installed(); assert.equal(after.version, '0.0.2'); assert.ok(after.source.includes('0.0.2-'));
  const saved = JSON.parse(await readFile(join(f.dir, 'package.json'), 'utf8'));
  assert.deepEqual(saved.dsh.profile.bundles, [PACKAGE_NAME]);
  assert.equal(JSON.parse(await readFile(join(f.dir, 'node_modules', PACKAGE_NAME, 'package.json'), 'utf8')).version, '0.0.2');
});

test('stock rc.3 native manager: failed package admission restores the isolated profile manifest and lockfile', async t => {
  const f = await updateManagerFixture(t); const old = await f.pack('0.0.3');
  const first = await f.manager.installBundle(old, { requestId: randomUUID(), enabled: true, saveExact: true });
  assert.equal(first.error, undefined, JSON.stringify(first));
  const manifest = await readFile(join(f.dir, 'package.json')); const lock = await readFile(join(f.dir, 'pnpm-lock.yaml'));
  const malformed = await f.pack('0.0.4', false);
  const result = await f.manager.installBundle(malformed, { requestId: randomUUID(), enabled: true, saveExact: true });
  assert.equal(result.application, 'failed'); assert.equal(result.error?.code, 'not-bundle');
  assert.deepEqual(await readFile(join(f.dir, 'package.json')), manifest); assert.deepEqual(await readFile(join(f.dir, 'pnpm-lock.yaml')), lock);
});
