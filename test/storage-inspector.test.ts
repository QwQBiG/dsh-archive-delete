import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, parse } from 'node:path';
import test from 'node:test';
import { ArchiveError, type ArchiveApi, type Overview, type StorageOverview } from '../src/contracts.js';
import { getStorageSources, getStorageWorkspaces, type HostContext } from '../src/dsh-adapter.js';
import { createRequestHandler, parseApiRequest } from '../src/host-routes.js';
import { StorageInspector, wrapArchiveApi } from '../src/storage-inspector.js';
import { scanStorage, type UsageScanOptions } from '../src/storage-usage.js';
import { apply } from '../src/index.js';

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'archive-storage-inspector-')));
  const home = join(root, 'host'); const project = join(root, 'project');
  await mkdir(home); await mkdir(project);
  const anchor = join(root, 'host-package.json');
  await writeFile(anchor, JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.1-rc.3' }));
  const record = { path: project, title: 'Selected project' };
  const state = { workspaceIds: ['project'] };
  const ctx: HostContext = { dshHomePath: () => home, profileContext: { installAnchor: anchor },
    workspaceRegistry: { requireState: () => state, entities: new Map([['project', { record }]]) },
    sessionPersistence: { root: join(home, 'custom-sessions') } };
  return { root, home, project, ctx, state, record, anchor, cleanup: () => rm(root, { recursive: true, force: true }) };
}
const resolver = (ctx: HostContext) => ({ workspaces: () => getStorageWorkspaces(ctx), sources: (id?: string) => getStorageSources(ctx, id) });
const overview: Overview = { support: { supported: true, version: '0.2.1-rc.3', platform: 'darwin' }, archived: [], trash: [], recentResults: [] };
function archiveApi(): ArchiveApi {
  return { list: async () => overview, preview: async () => { throw new Error('unused'); },
    execute: async () => ({ operationId: 'mutation', action: 'trash', items: [], counts: { succeeded: 0, pending: 0, skipped: 0, failed: 0 } }),
    cancelPending: async () => { throw new Error('unused'); } };
}
function request(body: unknown, signal?: AbortSignal): Request {
  return new Request('http://127.0.0.1/api/dsh-archive-delete', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body), ...(signal ? { signal } : {}) });
}

test('host storage uses active configured metadata without opening any provider and separates nested categories', async () => {
  const f = await fixture();
  try {
    const attachments = join(f.root, 'configured-attachments');
    const attachmentCache = join(f.home, 'cache', 'attachment-images');
    const spill = join(f.root, 'current-process-spill'); const settings = join(f.root, 'configured-settings');
    f.ctx.attachments = { root: attachments, cacheRoot: attachmentCache, open: () => assert.fail('attachments opened') };
    f.ctx.spillStore = { root: spill, config: { root: join(f.root, 'wrong-config') }, write: () => assert.fail('spill written') };
    f.ctx.storage = { backend: new Map([['json', { root: settings, open: () => assert.fail('JSON opened') }]]) };
    f.ctx.sessionQuery = { config: { path: join(f.root, 'configured-search.sqlite') }, _ensureReady: () => assert.fail('query opened') };
    const roots = await getStorageSources(f.ctx);
    const byId = new Map(roots.map(item => [item.id, item]));
    assert.equal(byId.get('sessions')?.path, join(f.home, 'custom-sessions'));
    assert.equal(byId.get('attachments')?.path, attachments);
    assert.equal(byId.get('attachment-cache')?.path, attachmentCache);
    assert.equal(byId.get('spill')?.path, spill);
    assert.equal(byId.get('settings')?.path, settings);
    assert.deepEqual(byId.get('cache')?.excludePaths, [attachmentCache]);
    assert.equal(byId.get('search')?.file, true);
    assert.equal(byId.get('search')?.path, join(f.root, 'configured-search.sqlite'));
    assert.ok(byId.get('other')?.excludePaths?.includes(join(f.home, 'cache')));
    assert.ok(roots.every(item => item.readOnly && !item.label));
    assert.deepEqual(getStorageWorkspaces(f.ctx), [{ id: 'project', title: 'Selected project' }]);
    assert.equal(JSON.stringify(getStorageWorkspaces(f.ctx)).includes(f.project), false);
  } finally { await f.cleanup(); }
});

test('unknown owners and in-memory search are unavailable rather than invented zero-byte roots', async () => {
  const f = await fixture();
  try {
    f.ctx.sessionQuery = { config: { path: ':memory:' } };
    const roots = await getStorageSources(f.ctx); const result = await scanStorage(roots);
    for (const kind of ['attachments', 'attachment-cache', 'settings', 'spill', 'search']) {
      const category = result.categories.find(item => item.kind === kind)!;
      assert.equal(category.status, 'unavailable'); assert.equal(category.fileBytes, null);
    }
    assert.deepEqual(result.categories.find(item => item.kind === 'search')?.issues, [{ code: 'in-memory' }]);
  } finally { await f.cleanup(); }
});

test('only registered server IDs select one project; roots, home and host-data directories are refused', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.project, 'unknown.bin'), '12345');
    const inspector = new StorageInspector(resolver(f.ctx));
    const selected = await inspector.scan('project');
    assert.equal(selected.scope, 'workspace'); assert.equal(selected.workspaceId, 'project');
    assert.equal(selected.fileBytes, 5); assert.equal(selected.categories.length, 1);
    assert.equal(selected.categories[0]?.label, 'Selected project');
    assert.equal(selected.categories[0]?.largestFiles[0]?.source, 'unknown');
    assert.equal(JSON.stringify(selected).includes(f.root), false);
    await assert.rejects(() => inspector.scan(f.project), { code: 'workspace-not-found' });
    for (const path of [parse(f.project).root, homedir(), dirname(homedir()), f.home, join(f.home, 'custom-sessions'), 'relative/project']) {
      f.record.path = path;
      await assert.rejects(() => inspector.scan('project'), { code: 'unsafe-workspace' });
    }
    const custom = join(f.root, 'outside-spill'); await mkdir(custom);
    f.ctx.spillStore = { root: custom }; f.record.path = custom;
    await assert.rejects(() => inspector.scan('project'), { code: 'unsafe-workspace' });
    f.record.path = f.project; f.state.workspaceIds = [];
    await assert.rejects(() => inspector.scan('project'), { code: 'workspace-not-found' });
    await inspector.close();
  } finally { await f.cleanup(); }
});

test('registered projects may contain host state or live below DSH home while internal descendants are excluded', async () => {
  const f = await fixture();
  try {
    const data = join(f.project, '.dsh'); const sessions = join(data, 'sessions');
    await mkdir(sessions, { recursive: true });
    await writeFile(join(sessions, 'host-log'), 'private host state');
    await writeFile(join(f.project, 'project.txt'), '123');
    f.ctx.sessionPersistence = { root: sessions };
    const inspector = new StorageInspector(resolver(f.ctx));
    const result = await inspector.scan('project');
    assert.equal(result.fileBytes, 3); assert.equal(result.categories[0]?.counters.excluded, 1);
    const nested = join(f.home, 'workspaces', 'registered-project'); await mkdir(nested, { recursive: true });
    await writeFile(join(nested, 'project.txt'), '1234'); f.record.path = nested;
    const host = await inspector.scan();
    assert.equal(host.categories.find(category => category.kind === 'other')?.fileBytes, 0);
    assert.ok(!host.categories.some(category => category.largestFiles.some(file => file.relativePath.includes('project.txt'))));
    assert.equal((await inspector.scan('project')).fileBytes, 4);
    await inspector.close();
  } finally { await f.cleanup(); }
});

test('workspace links are refused and missing projects are observed without creating them', async () => {
  const f = await fixture();
  try {
    const link = join(f.root, 'linked-project');
    await symlink(f.project, link, process.platform === 'win32' ? 'junction' : 'dir');
    f.record.path = link;
    await assert.rejects(() => getStorageSources(f.ctx, 'project'), { code: 'unsafe-workspace' });
    f.record.path = join(f.root, 'not-created');
    const result = await new StorageInspector(resolver(f.ctx)).scan('project');
    assert.equal(result.categories[0]?.status, 'missing');
    await assert.rejects(() => realpath(f.record.path), { code: 'ENOENT' });
  } finally { await f.cleanup(); }
});

test('project ID/path changes during observation discard the stale scope', async () => {
  const f = await fixture();
  try {
    const inspector = new StorageInspector(resolver(f.ctx), { scan: async (roots, options) => {
      const result = await scanStorage(roots, options); f.record.path = join(f.root, 'moved-project'); return result;
    } });
    await assert.rejects(() => inspector.scan('project'), { code: 'workspace-changed' });
    await inspector.close();
  } finally { await f.cleanup(); }
});

test('scan admission is separate from mutation calls, bounded, cancellable and awaited on close', async () => {
  const f = await fixture();
  try {
    let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
    let observed: UsageScanOptions | undefined;
    const inspector = new StorageInspector(resolver(f.ctx), { scan: async (roots, options) => {
      observed = options; entered();
      await new Promise<void>(resolve => options.signal!.addEventListener('abort', () => resolve(), { once: true }));
      return scanStorage(roots, options);
    } });
    const api = wrapArchiveApi(archiveApi(), inspector);
    const scan = api.storage!(); await started;
    assert.equal(observed?.maxDurationMs, 5_000); assert.equal(observed?.maxEntries, 50_000);
    await assert.rejects(() => api.storage!('project'), { code: 'scan-busy' });
    assert.equal((await api.execute('preview', 'request')).operationId, 'mutation');
    assert.deepEqual((await api.list()).storageWorkspaces, [{ id: 'project', title: 'Selected project' }]);
    const cancelled = assert.rejects(() => scan, { code: 'scan-cancelled' });
    await inspector.close(); await cancelled;
    assert.equal(observed?.signal?.aborted, true);
    await assert.rejects(() => inspector.scan(), { code: 'scan-closed' });
  } finally { await f.cleanup(); }
});

test('request abort is joined to the scan and a later request can run after cancellation', async () => {
  const f = await fixture();
  try {
    const controller = new AbortController();
    const inspector = new StorageInspector(resolver(f.ctx), { scan: async (roots, options) => {
      controller.abort(); return scanStorage(roots, options);
    } });
    await assert.rejects(() => inspector.scan(undefined, controller.signal), { code: 'scan-cancelled' });
    const complete = await inspector.scan(); assert.equal(complete.scope, 'host');
    await inspector.close();
  } finally { await f.cleanup(); }
});

test('read-only resolver failures do not alter archive methods, their receiver or cheap list', async () => {
  class Api {
    calls = 0;
    async list() { this.calls++; return overview; }
    async preview(): Promise<never> { this.calls++; throw new ArchiveError('expected', 'archive reached'); }
    async execute(): Promise<never> { throw new Error('unused'); }
    async cancelPending(): Promise<never> { throw new Error('unused'); }
  }
  const original = new Api();
  const inspector = new StorageInspector({ workspaces: () => { throw new Error('metadata unavailable'); },
    sources: async () => { throw new ArchiveError('unsupported-host', 'metadata unavailable'); } });
  const api = wrapArchiveApi(original, inspector);
  assert.deepEqual((await api.list()).storageWorkspaces, []);
  await assert.rejects(() => api.storage!(), { code: 'unsupported-host' });
  await assert.rejects(() => api.preview('trash', ['session']), { code: 'expected' });
  assert.equal(original.calls, 2); await inspector.close();
});

test('storage route only accepts an optional bounded ID and forwards cancellation through the owner handler', async () => {
  assert.deepEqual(parseApiRequest({ action: 'storage' }), { action: 'storage' });
  assert.deepEqual(parseApiRequest({ action: 'storage', workspaceId: 'project' }), { action: 'storage', workspaceId: 'project' });
  for (const input of [{ action: 'storage', path: '/private' }, { action: 'storage', workspaceId: 'id', path: '/private' },
    { action: 'storage', workspaceId: '' }, { action: 'storage', workspaceId: 'a\0b' },
    { action: 'storage', workspaceId: 'a'.repeat(513) }, { action: 'storage', workspaceId: 1 }])
    assert.throws(() => parseApiRequest(input), { code: 'invalid-request' });
  let received: string | undefined; let signal: AbortSignal | undefined;
  const api = archiveApi();
  const result = { ...(await scanStorage([])), scope: 'workspace' as const, workspaceId: 'project', workspaces: [] };
  api.storage = async (id, requestSignal) => { received = id; signal = requestSignal; return result; };
  const controller = new AbortController(); const transport = request({ action: 'storage', workspaceId: 'project' }, controller.signal);
  const response = await createRequestHandler(api)(transport);
  assert.equal(response.status, 200); assert.equal(received, 'project'); assert.equal(signal, transport.signal);
  controller.abort(); assert.equal(signal?.aborted, true);
  assert.deepEqual(await response.json(), { ok: true, value: result });
  const unsupported = await createRequestHandler(archiveApi())(request({ action: 'storage' }));
  assert.equal(unsupported.status, 409); assert.match(await unsupported.text(), /unsupported-host/);
});

test('disabled plugin exposes a rejecting storage API without allocating or scanning data', async () => {
  const f = await fixture();
  try {
    await writeFile(f.anchor, JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.0' }));
    let handler: ((request: Request) => Promise<Response>) | undefined;
    const close = await apply({ ...f.ctx, connection: { fetch: { register: (route: { fetch: typeof handler }) => { handler = route.fetch; return () => {}; } } } });
    const response = await handler!(request({ action: 'storage' }));
    assert.equal(response.status, 409); assert.match(await response.text(), /unsupported-host/);
    const listed = await handler!(request({ action: 'list' }));
    assert.equal(listed.status, 200); await close();
    await assert.rejects(() => realpath(join(f.home, 'archive-delete')), { code: 'ENOENT' });
  } finally { await f.cleanup(); }
});
