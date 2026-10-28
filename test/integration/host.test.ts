import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { createRequire, registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import test, { type TestContext } from 'node:test';
import { acquirePluginLease, createDshAdapter, type HostContext } from '../../src/dsh-adapter.js';
import { ArchiveService } from '../../src/service.js';
import { TrashStore } from '../../src/storage.js';
import { registerHostRoutes } from '../../src/host-routes.js';
import type { JsonObject } from '../../src/contracts.js';

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
const { DomainFacility } = await host('@deepseek-ai/dsh-storage-domain');
const { JsonStorageBackend } = await host('@deepseek-ai/dsh-storage-json');
const { SessionProjectionRegistry } = await host('@deepseek-ai/dsh-session-projection');
const { titleProjectionDefinition } = await host('@deepseek-ai/dsh-session-title');
const { SessionProjectionCache, projectionCacheDomainSpec } = await host('@deepseek-ai/dsh-session-projection-cache');
const { WorkspaceRegistry } = await host('@deepseek-ai/dsh-workspace');
const jsonl = await host('@deepseek-ai/dsh-session-persistence-jsonl');
const { HostConnectionService } = await host('@deepseek-ai/dsh-client-connection');

async function fixture(t: TestContext, compression = 'none') {
  const home = await mkdtemp(join(tmpdir(), 'archive-native-'));
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

test('stock rc.3: relocated session lease follows inode; native writers and another plugin process cannot steal it', async t => {
  const f = await fixture(t); await f.create('leased');
  const group = await f.adapter.inspect('leased');
  const held = await f.adapter.acquire(group); assert.equal(held.kind, 'acquired'); if (held.kind !== 'acquired') return;
  const relocated = join(f.home, 'relocated'); await rename(group.members[0]!.directory, relocated);
  try {
    const lockPath = join(relocated, 'session.lock');
    const flockPath = hostRequire.resolve('@deepseek-ai/node-addon-system/flock');
    const script = `import {open} from 'node:fs/promises';import {tryLockExclusive} from ${JSON.stringify(pathToFileURL(flockPath).href)};const handle=await open(process.argv[1],'r+');try{await tryLockExclusive(handle.fd);process.exitCode=9}catch(e){if(e.code!=='EAGAIN'&&e.code!=='EWOULDBLOCK')throw e}finally{await handle.close()}`;
    const run = (filename: string) => new Promise<number>((resolve, reject) => { const child = spawn(process.execPath, ['--input-type=module', '-e', script, filename], { stdio: ['ignore', 'ignore', 'pipe'] }); let stderr=''; child.stderr.on('data', chunk=>{stderr+=String(chunk)}); child.on('error', reject); child.on('exit', exit => exit === 0 ? resolve(exit) : reject(new Error(`foreign lock test: ${exit}: ${stderr}`))); });
    await run(lockPath);
    const second = await f.adapter.acquireLocated(group, [relocated]); assert.equal(second.kind, 'busy');
    const pluginLease = await acquirePluginLease(join(f.home, 'archive-delete'));
    try { await run(join(f.home, 'archive-delete', '.lock')); await assert.rejects(acquirePluginLease(join(f.home, 'archive-delete')), { code: 'store-busy' }); }
    finally { await pluginLease.release(); }
  } finally { await held.lease.release(); }
  const available = await f.adapter.acquireLocated(group, [relocated]); assert.equal(available.kind, 'acquired'); if (available.kind === 'acquired') await available.lease.release();
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

test('stock rc.3: explicit partial-purge retry locks the remaining member with preserved slot identity', async t => {
  const f = await fixture(t); await f.create('partial-parent');
  await f.create('partial-child', 'Child', { parentSession: 'partial-parent', origin: 'subagent' });
  assert.equal((await f.execute('trash', ['partial-parent'])).items[0]!.status, 'moved');
  const entry = (await f.api.list()).trash[0]!;
  const { readdir, rmdir, unlink } = await import('node:fs/promises');
  const removedMember = join(f.home, 'archive-delete', 'trash', entry.id, '0');
  // Model a crash after the first synthetic member was completely purged.
  for (const filename of await readdir(removedMember)) await unlink(join(removedMember, filename));
  await rmdir(removedMember);
  const manifest = await f.store.manifest(entry.id); const locations = await f.store.entryLocations(entry.id);
  assert.equal(locations.length, 2); assert.equal(locations[0], undefined);
  const held = await f.adapter.acquireLocated(manifest.group, locations); assert.equal(held.kind, 'acquired');
  if (held.kind !== 'acquired') return;
  try { assert.equal((await f.adapter.acquireLocated(manifest.group, locations)).kind, 'busy'); }
  finally { await held.lease.release(); }
  const restore = await f.api.preview('restore', [entry.id]); assert.equal(restore.items[0]!.disposition, 'blocked');
  assert.equal((await f.execute('purge', [entry.id])).items[0]!.status, 'purged');
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
