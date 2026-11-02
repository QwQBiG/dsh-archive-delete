import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { acquirePluginLease, createDshAdapter, getNativeLockExclusive, getNativeWindowsLock, getStorageSources, isLocalWindowsDriveType, windowsSessionLockName, type HostContext } from '../src/dsh-adapter.js';
import type { JsonObject } from '../src/contracts.js';
import { createRequestHandler, parseApiRequest, registerHostRoutes } from '../src/host-routes.js';
import type { ArchiveApi } from '../src/contracts.js';
import { apply } from '../src/index.js';

async function fixture() {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'archive-adapter-')));
  const sessionsRoot = join(home, 'sessions');
  await mkdir(join(sessionsRoot, '--project--'), { recursive: true });
  const snapshots = new Map<string, { header: JsonObject; formatStatus: string; sizeBytes: number }>();
  const loaded = new Set<string>();
  const busy = new Set<string>();
  const projection = new Map<string, string>();
  const events: [string, unknown[]][] = [];
  let state = { workspaceIds: ['workspace'], archivedSessionIds: [] as string[], pinnedSessionIds: [] as string[] };
  const record = { id: 'workspace', path: '/project', title: 'Project', sessionIds: [] as string[], updatedAt: '' };
  const entities = new Map([['workspace', { record }]]);
  const table = new Map([['workspace', record]]);
  const registry = {
    get archivedSessionIds() { return state.archivedSessionIds; },
    requireState: () => state,
    setState: async (next: typeof state) => { state = next; },
    requireTable: () => ({
      get: (id: string) => table.get(id),
      update: async (id: string, transform: (item: typeof record) => typeof record) => {
        const next = transform(table.get(id)!); table.set(id, next); return next;
      },
    }),
    enqueueOperation: async <T>(operation: () => Promise<T>) => operation(),
    indexHeader: async (header: JsonObject) => { registry.headers.set(String(header.id), header); },
    entities,
    headers: new Map<string, unknown>(), sessionPaths: new Map<string, unknown>(),
    missingSessionPaths: new Set<string>(), invalidSessionPaths: new Map<string, unknown>(),
  };
  const ctx: HostContext = {
    sessionPersistence: {
      name: 'session-persistence-jsonl', root: sessionsRoot,
      list: async () => [...snapshots.values()],
      stat: async (id: string) => snapshots.get(id),
      open: async (id: string) => ({ header: snapshots.get(id)!.header, inheritedEventCount: 0, read: async () => ({ events: [{ title: `Title ${id}` }] }), close: async () => {} }),
      locate: (header: JsonObject) => ({ kind: 'jsonl', path: join(sessionsRoot, '--project--', String(header.id), 'session.v4.jsonl') }),
    },
    workspaceRegistry: registry,
    sessions: { get: (id: string) => loaded.has(id) ? {} : undefined },
    sessionProjections: { restore: (_rows: object, events: unknown[]) => ({ checkpoint: { title: (events[0] as { title: string }).title } }) },
    sessionProjectionCache: {
      put: async (id: string, _identity: unknown, rows: { title: string }) => { projection.set(id, rows.title); },
      cachedSnapshot: (header: JsonObject) => ({ values: { title: projection.get(String(header.id)) } }),
      requireTable: () => ({ delete: async (id: string) => { projection.delete(id); } }),
    },
    waterfall: async (_event, request) => busy.has(request.sessionId) ? [{ kind: 'schedule', label: 'Reminder' }] : [],
    emit: (event, ...args) => { events.push([event, args]); },
  };
  async function add(id: string, options: { origin?: string; parent?: string; archived?: boolean; formatStatus?: string } = {}) {
    const header: JsonObject = { id, version: 4, createdAt: 1000, cwd: '/project', isSeeded: !!options.parent && options.origin !== 'subagent',
      ...(options.origin ? { origin: options.origin } : {}), ...(options.parent ? { parentSession: options.parent } : {}) };
    const directory = join(sessionsRoot, '--project--', id);
    await mkdir(directory);
    await writeFile(join(directory, 'session.v4.jsonl'), `${JSON.stringify(header)}\n`);
    snapshots.set(id, { header, formatStatus: options.formatStatus ?? 'current', sizeBytes: 100 });
    registry.headers.set(id, header); registry.sessionPaths.set(id, '/project');
    record.sessionIds.push(id); projection.set(id, `Title ${id}`);
    if (options.archived !== false) state.archivedSessionIds.push(id);
    return directory;
  }
  const adapter = await createDshAdapter(ctx, { home, version: '0.2.1-rc.3', platform: 'darwin', lockExclusive: async () => {} });
  return { home, sessionsRoot, snapshots, loaded, busy, projection, events, registry, table, entities, ctx, adapter, add, state: () => state,
    cleanup: () => rm(home, { recursive: true, force: true }) };
}

test('adapter gates unsupported versions and platforms without touching session data', async () => {
  const f = await fixture();
  try {
    const wrongVersion = await createDshAdapter(f.ctx, { home: f.home, version: '0.3.0', platform: 'darwin' });
    assert.equal((await wrongVersion.capabilities()).supported, false);
    await assert.rejects(() => wrongVersion.listArchived(), { code: 'unsupported-host' });
    const wrongPlatform = await createDshAdapter(f.ctx, { home: f.home, version: '0.2.1-rc.3', platform: 'linux' });
    assert.equal((await wrongPlatform.capabilities()).supported, false);
  } finally { await f.cleanup(); }
});

test('adapter and storage admit only explicitly supported host manifests, including rc.5', async () => {
  const f = await fixture();
  try {
    await f.add('version-gate'); const anchor = join(f.home, 'live-host-package.json');
    const ctx = { ...f.ctx, profileContext: { installAnchor: anchor }, dshHomePath: () => f.home };
    for (const [version, expected] of [['0.2.1-rc.3', true], ['0.2.1-rc.5', true], ['0.2.1-rc.4', false], ['0.2.1-rc.6', false], ['0.3.0', false]] as const) {
      await writeFile(anchor, JSON.stringify({ name: '@deepseek-ai/dsh', version }));
      const adapter = await createDshAdapter(ctx, { home: f.home, platform: 'darwin', lockExclusive: async () => {} });
      const status = await adapter.capabilities();
      assert.equal(status.version, version); assert.equal(status.supported, expected, version);
      if (expected) {
        assert.equal((await adapter.inspect('version-gate')).sessionId, 'version-gate');
        assert.equal((await getStorageSources(ctx)).find(root => root.id === 'sessions')!.path, f.sessionsRoot);
      } else {
        await assert.rejects(adapter.listArchived(), { code: 'unsupported-host' });
        await assert.rejects(getStorageSources(ctx), { code: 'unsupported-host' });
      }
    }
    assert.equal((await f.adapter.listArchived()).length, 1);
    await assert.rejects(access(join(f.home, 'archive-delete')), { code: 'ENOENT' });
  } finally { await f.cleanup(); }
});

test('startup reports the required and current version before creating storage and keeps the disabled API readable', async () => {
  const f = await fixture();
  try {
    const anchor = join(f.home, 'runtime-package.json');
    await writeFile(anchor, JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.1-rc.2' }));
    const warnings: string[] = [];
    const info: string[] = [];
    let handler: ((request: Request) => Promise<Response>) | undefined;
    let unmounted = false;
    const close = await apply({ ...f.ctx, profileContext: { installAnchor: anchor }, dshHomePath: () => f.home,
      logger: { warn: message => warnings.push(message), info: message => info.push(message) },
      connection: { fetch: { register: (route: { fetch: (request: Request) => Promise<Response> }) => { handler = route.fetch; return () => { unmounted = true; }; } } },
    });
    assert.equal(warnings.length, 1);
    assert.deepEqual(info, []);
    assert.match(warnings[0]!, /0\.2\.1-rc\.3.*0\.2\.1-rc\.2.*Update DSH Desktop/);
    await assert.rejects(access(join(f.home, 'archive-delete')), { code: 'ENOENT' });
    assert.ok(handler);
    const request = (body: unknown) => new Request('http://127.0.0.1/api/dsh-archive-delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const response = await handler(request({ action: 'list' }));
    const body = await response.json() as { ok: boolean; value: { support: { version: string; supported: boolean; reason: string } } };
    assert.equal(body.ok, true);
    assert.equal(body.value.support.supported, false);
    assert.equal(body.value.support.version, '0.2.1-rc.2');
    assert.match(body.value.support.reason, /Update DSH Desktop/);
    const rejected = await handler(request({ action: 'preview', operation: 'trash', ids: ['session'] }));
    assert.equal(rejected.status, 422);
    assert.match(await rejected.text(), /unsupported-host/);
    await close(); assert.equal(unmounted, true);
  } finally { await f.cleanup(); }
});

test('ownership includes explicit subagent descendants and preserves independent current-format forks', async () => {
  const f = await fixture();
  try {
    await f.add('parent');
    await f.add('child', { origin: 'subagent', parent: 'parent', archived: false });
    await f.add('grandchild', { origin: 'subagent', parent: 'child', archived: false });
    await f.add('fork', { parent: 'parent', archived: false });
    const group = await f.adapter.inspect('parent');
    assert.deepEqual(group.members.map((member) => member.id), ['parent', 'child', 'grandchild']);
    const rows = await f.adapter.listArchived();
    assert.equal(rows.length, 1); assert.equal(rows[0]!.descendantCount, 2);
    assert.equal(rows[0]!.title, 'Title parent');
    await assert.rejects(() => f.adapter.inspect('child'), { code: 'subagent-target' });
  } finally { await f.cleanup(); }
});

test('legacy dependent forks and cyclic subagents fail closed', async () => {
  const f = await fixture();
  try {
    await f.add('parent');
    await f.add('legacy-fork', { parent: 'parent', archived: false, formatStatus: 'migration-required' });
    await assert.rejects(() => f.adapter.inspect('parent'), { code: 'dependent-session' });
    f.snapshots.delete('legacy-fork');
    f.snapshots.get('parent')!.header.parentSession = 'child';
    f.snapshots.get('parent')!.header.origin = 'subagent';
    await f.add('child', { origin: 'subagent', parent: 'parent' });
    await assert.rejects(() => f.adapter.inspect('parent'), { code: 'subagent-target' });
  } finally { await f.cleanup(); }
});

test('damaged sessions do not hide healthy archives and their relationship components stay protected', async t => {
  const f = await fixture(); t.after(f.cleanup);
  await f.add('healthy'); await f.add('affected'); await f.add('broken-child', { origin: 'subagent', parent: 'affected', archived: false });
  delete f.snapshots.get('broken-child')!.header.createdAt;
  assert.deepEqual((await f.adapter.listArchived()).map(item => item.id), ['healthy', 'affected']);
  assert.deepEqual(f.adapter.listIssues?.().map(issue => [issue.scope, issue.id, issue.code]), [['archive', 'broken-child', 'invalid-session']]);
  assert.equal((await f.adapter.inspect('healthy')).sessionId, 'healthy');
  await assert.rejects(f.adapter.inspect('affected'), { code: 'invalid-session' });
  await assert.rejects(f.adapter.inspect('broken-child'), { code: 'invalid-session' });
});

test('duplicate identities are excluded together and unlocatable damage blocks mutation without hiding healthy rows', async t => {
  const f = await fixture(); t.after(f.cleanup); await f.add('healthy'); await f.add('duplicate');
  const persistence = f.ctx.sessionPersistence as { list(): Promise<unknown[]> };
  persistence.list = async () => [...f.snapshots.values(), { ...f.snapshots.get('duplicate')! }];
  assert.deepEqual((await f.adapter.listArchived()).map(item => item.id), ['healthy']);
  assert.equal((await f.adapter.inspect('healthy')).sessionId, 'healthy');
  await assert.rejects(f.adapter.inspect('duplicate'), { code: 'invalid-session' });
  persistence.list = async () => [...f.snapshots.values(), { header: { createdAt: 1 } }];
  assert.equal((await f.adapter.listArchived()).length, 2);
  await assert.rejects(f.adapter.inspect('healthy'), { code: 'invalid-session' });
  assert.ok(f.adapter.listIssues?.().some(issue => issue.id === undefined));
});

test('malformed diagnostic identifiers cannot poison the healthy list response', async t => {
  const f = await fixture(); t.after(f.cleanup); await f.add('healthy');
  for (const [key, id] of [['oversized', 'x'.repeat(513)], ['nul', 'broken\0identity']])
    f.snapshots.set(key!, { header: { id: id!, version: 4, createdAt: 1000 }, formatStatus: 'current', sizeBytes: 0 });
  assert.deepEqual((await f.adapter.listArchived()).map(item => item.id), ['healthy']);
  assert.equal(f.adapter.listIssues?.().length, 2);
  assert.ok(f.adapter.listIssues?.().every(issue => issue.id === undefined && issue.code === 'invalid-session'));
  await assert.rejects(f.adapter.inspect('healthy'), { code: 'invalid-session' });
});

test('restore compares header values independently of key order and the native zero-depth default', async t => {
  const f = await fixture(); t.after(f.cleanup); await f.add('parent');
  const group = await f.adapter.inspect('parent'); const snapshot = f.snapshots.get('parent')!;
  snapshot.header = { delegationDepth: 0, ...Object.fromEntries(Object.entries(snapshot.header).reverse()) };
  await f.adapter.restoreRegistry(group); assert.equal(f.projection.get('parent'), 'Title parent');
  snapshot.header = { ...snapshot.header, cwd: '/another-project' };
  await assert.rejects(f.adapter.restoreRegistry(group), { code: 'restore-identity' });
});

test('source revisions ignore lock creation but change when any canonical generation changes', async () => {
  const f = await fixture();
  try {
    const dir = await f.add('parent');
    const first = await f.adapter.inspect('parent');
    const lease = await f.adapter.acquire(first);
    assert.equal(lease.kind, 'acquired');
    const locked = await f.adapter.inspect('parent');
    assert.equal(locked.members[0]!.revision, first.members[0]!.revision);
    if (lease.kind === 'acquired') await lease.lease.release();
    await writeFile(join(dir, 'session.v3.jsonl'), 'older generation');
    assert.notEqual((await f.adapter.inspect('parent')).members[0]!.revision, first.members[0]!.revision);
  } finally { await f.cleanup(); }
});

test('loaded sessions queue while activity and external lock contention remain separately identifiable', async () => {
  const f = await fixture();
  try {
    await f.add('parent'); f.loaded.add('parent'); f.busy.add('parent');
    const group = await f.adapter.inspect('parent');
    assert.deepEqual(group.members[0]!.activity, [{ kind: 'schedule', label: 'Reminder' }]);
    assert.equal((await f.adapter.acquire(group)).kind, 'busy');
    f.busy.clear();
    assert.equal((await f.adapter.acquire(group)).kind, 'loaded');
    f.loaded.clear();
    const blocked = await createDshAdapter(f.ctx, { home: f.home, version: '0.2.1-rc.3', platform: 'darwin',
      lockExclusive: async () => { throw Object.assign(new Error('busy'), { code: 'EWOULDBLOCK' }); } });
    assert.equal((await blocked.acquire(group)).kind, 'busy');
  } finally { await f.cleanup(); }
});

test('registry remove/restore keeps unrelated concurrent state and restores to archive', async () => {
  const f = await fixture();
  try {
    const directory = await f.add('parent');
    await f.add('fork', { parent: 'parent', archived: false });
    const group = await f.adapter.inspect('parent');
    const moved = join(f.home, 'moved'); await rename(directory, moved);
    await f.adapter.removeRegistry(group);
    assert.deepEqual(f.state().archivedSessionIds, []);
    assert.deepEqual(f.table.get('workspace')!.sessionIds, ['fork']);
    assert.equal(f.projection.has('parent'), false);
    assert.deepEqual(f.events[0], ['api-session/removed', ['parent']]);
    f.state().archivedSessionIds.push('unrelated');
    await rename(moved, directory);
    await f.adapter.restoreRegistry(group);
    assert.deepEqual(f.state().archivedSessionIds, ['unrelated', 'parent']);
    assert.deepEqual(f.table.get('workspace')!.sessionIds, ['parent', 'fork']);
    assert.equal(f.events.at(-1)![0], 'api-session/added');
    await f.adapter.restoreRegistry(group);
    assert.deepEqual(f.table.get('workspace')!.sessionIds, ['parent', 'fork']);
  } finally { await f.cleanup(); }
});

test('restoring without the old workspace does not create directories or re-create the workspace', async () => {
  const f = await fixture();
  try {
    const dir = await f.add('parent'); const group = await f.adapter.inspect('parent');
    const body = await readFile(join(dir, 'session.v4.jsonl'));
    f.table.delete('workspace'); f.entities.clear();
    await f.adapter.restoreRegistry(group);
    assert.equal(f.table.size, 0);
    assert.equal(f.state().archivedSessionIds.includes('parent'), true);
    assert.deepEqual(await readFile(join(dir, 'session.v4.jsonl')), body);
  } finally { await f.cleanup(); }
});

test('symbolic-link storage and unexpected artifacts are refused', async () => {
  const f = await fixture();
  try {
    const dir = await f.add('parent');
    await writeFile(join(dir, 'private.txt'), 'must survive');
    await assert.rejects(() => f.adapter.inspect('parent'), { code: 'unknown-artifact' });
    await rm(join(dir, 'private.txt'));
    const outside = join(f.home, 'outside'); await rename(dir, outside); await symlink(outside, dir);
    await assert.rejects(() => f.adapter.inspect('parent'), { code: 'unsafe-path' });
    assert.ok((await readFile(join(outside, 'session.v4.jsonl'), 'utf8')).includes('parent'));
  } finally { await f.cleanup(); }
});

test('transport accepts only its bounded operation contract, never browser paths', async () => {
  const calls: unknown[] = [];
  const api: ArchiveApi = {
    list: async () => { calls.push('list'); return { support: { supported: true, version: '0.2.1-rc.3', platform: 'darwin' }, archived: [], trash: [], recentResults: [] }; },
    preview: async (action, ids) => { calls.push([action, ids]); return { id: 'preview', action, items: [], expiresAt: 1 }; },
    execute: async () => { throw new Error('private filesystem failure /private/secret'); },
    cancelPending: async () => { throw new Error('unused'); },
  };
  const handler = createRequestHandler(api);
  const request = (body: unknown) => new Request('http://localhost/api/dsh-archive-delete', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal((await handler(request({ action: 'list' }))).status, 200);
  assert.deepEqual(calls, ['list']);
  assert.throws(() => parseApiRequest({ action: 'preview', operation: 'trash', ids: ['parent'], path: '/etc' }), { code: 'invalid-request' });
  assert.equal((await handler(request({ action: 'preview', operation: 'trash', ids: ['parent'], directory: '/etc' }))).status, 400);
  assert.equal((await handler(request({ action: 'preview', operation: 'trash', ids: ['parent', 'parent'] }))).status, 400);
  assert.equal((await handler(request({ action: 'preview', operation: 'trash', ids: ['a'.repeat(70_000)] }))).status, 413);
  const error = await handler(request({ action: 'execute', previewId: 'preview', requestId: 'request' }));
  assert.equal(error.status, 500);
  assert.equal((await error.text()).includes('/private/secret'), false);
  assert.equal((await handler(new Request('http://localhost/api/dsh-archive-delete'))).status, 405);
});

test('API registration uses the existing owner-authenticated exact Connection route', () => {
  let mounted: unknown;
  let disposed = false;
  const api = {} as ArchiveApi;
  const dispose = registerHostRoutes({ connection: { fetch: { register: (route: unknown) => { mounted = route; return () => { disposed = true; }; } } } }, api);
  const route = mounted as { path: string; methods: string[]; requestBody: string };
  assert.equal(route.path, '/api/dsh-archive-delete');
  assert.deepEqual(route.methods, ['POST']);
  assert.equal(route.requestBody, 'streaming');
  dispose(); assert.equal(disposed, true);
  assert.throws(() => registerHostRoutes({}, api), { code: 'unsupported-host' });
});

test('a loaded root cannot queue a cold child held by a different process', async () => {
  const f = await fixture();
  try {
    await f.add('parent'); await f.add('child', { origin: 'subagent', parent: 'parent' });
    f.loaded.add('parent');
    const adapter = await createDshAdapter(f.ctx, { home: f.home, version: '0.2.1-rc.3', platform: 'darwin', lockExclusive: async () => { throw Object.assign(new Error('busy'), { code: 'EWOULDBLOCK' }); } });
    assert.equal((await adapter.acquire(await adapter.inspect('parent'))).kind, 'busy');
    f.snapshots.get('parent')!.header.parentSession = 'child';
    await assert.rejects(() => adapter.inspect('parent'), { code: 'ambiguous-lineage' });
  } finally { await f.cleanup(); }
});

test('restore preserves an unarchived subagent pin and concurrent unrelated pins', async () => {
  const f = await fixture();
  try {
    const parentDirectory = await f.add('parent');
    const childDirectory = await f.add('child', { origin: 'subagent', parent: 'parent', archived: false });
    await f.add('unrelated', { archived: false });
    f.state().pinnedSessionIds.push('child');
    const group = await f.adapter.inspect('parent');
    assert.equal(group.members.find(member => member.id === 'child')!.pinned, true);
    const movedParent = join(f.home, 'moved-parent'); const movedChild = join(f.home, 'moved-child');
    await rename(parentDirectory, movedParent); await rename(childDirectory, movedChild);
    await f.adapter.removeRegistry(group);
    assert.deepEqual(f.state().pinnedSessionIds, []);
    f.state().pinnedSessionIds.push('unrelated');
    await rename(movedParent, parentDirectory); await rename(movedChild, childDirectory);
    await f.adapter.restoreRegistry(group);
    assert.deepEqual(new Set(f.state().pinnedSessionIds), new Set(['child', 'unrelated']));
    assert.ok(f.state().archivedSessionIds.includes('parent'));
    assert.ok(!f.state().archivedSessionIds.includes('child'));
    assert.ok(!f.state().pinnedSessionIds.includes('parent'));
  } finally { await f.cleanup(); }
});


test('Windows path locks remain reserved across relocation without creating lock files', async () => {
  const f = await fixture();
  const held = new Set<string>();
  const lockNamed = async (filename: string) => {
    const name = windowsSessionLockName(filename);
    if (held.has(name)) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
    held.add(name); let released = false;
    return { release: async () => { if (!released) { released = true; held.delete(name); } } };
  };
  try {
    const source = await f.add('parent');
    const adapter = await createDshAdapter(f.ctx, { home: f.home, version: '0.2.1-rc.3', platform: 'win32', lockNamed,
      lockExclusive: async () => { throw new Error('Windows must not use POSIX flock'); } });
    assert.equal((await adapter.capabilities()).supported, true);
    const group = await adapter.inspect('parent'); const first = await adapter.acquire(group);
    assert.equal(first.kind, 'acquired'); if (first.kind !== 'acquired') return;
    await assert.rejects(readFile(join(source, 'session.lock')), { code: 'ENOENT' });
    const moved = join(f.home, 'relocated'); await rename(source, moved);
    assert.equal((await adapter.acquireLocated(group, [moved])).kind, 'busy');
    await first.lease.release();
    const next = await adapter.acquireLocated(group, [moved]);
    assert.equal(next.kind, 'acquired'); if (next.kind !== 'acquired') return;
    assert.ok(held.has(windowsSessionLockName(join(source, 'session.lock'))));
    assert.ok(held.has(windowsSessionLockName(join(moved, 'session.lock'))));
    await next.lease.release(); assert.equal(held.size, 0);
    const lease = await acquirePluginLease(join(f.home, 'plugin'), async () => { throw new Error('Windows must not open a lock file'); }, { platform: 'win32', lockNamed });
    await assert.rejects(acquirePluginLease(join(f.home, 'plugin'), async () => {}, { platform: 'win32', lockNamed }), { code: 'store-busy' });
    await lease.release();
  } finally { await f.cleanup(); }
});

test('Windows lock identity normalizes drive and path casing consistently', () => {
  assert.equal(windowsSessionLockName(String.raw`C:\Users\Ada\Sessions\thread\session.lock`), windowsSessionLockName(String.raw`c:\users\ada\sessions\THREAD\session.lock`));
  assert.notEqual(windowsSessionLockName(String.raw`C:\Users\Ada\Sessions\thread\session.lock`), windowsSessionLockName(String.raw`C:\Users\Ada\Trash\thread\session.lock`));
});

test('Windows drive admission rejects remote, missing, and unknown media', () => {
  for (const kind of [0, 1, 4, 5, 7]) assert.equal(isLocalWindowsDriveType(kind), false);
  for (const kind of [2, 3, 6]) assert.equal(isLocalWindowsDriveType(kind), true);
});

test('a transient peer resolution failure can recover on the next native lock attempt', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'archive-lock-resolution-'))); t.after(() => rm(root, { recursive: true, force: true }));
  const anchor = join(root, 'package.json'); await writeFile(anchor, JSON.stringify({ name: 'synthetic-host', type: 'module' }));
  const ctx: HostContext = { profileContext: { installAnchor: anchor } };
  const lock = getNativeLockExclusive(ctx); await assert.rejects(lock(0));
  const moduleRoot = join(root, 'node_modules', '@deepseek-ai', 'node-addon-system'); await mkdir(moduleRoot, { recursive: true });
  await writeFile(join(moduleRoot, 'package.json'), JSON.stringify({ name: '@deepseek-ai/node-addon-system', type: 'module', exports: { './flock': './flock.mjs' } }));
  await writeFile(join(moduleRoot, 'flock.mjs'), 'export async function tryLockExclusive(fd) { if (fd !== 17) throw new Error("unexpected descriptor"); }');
  await lock(17);
  const lockNamed = getNativeWindowsLock(ctx); const filename = join(root, 'session.lock');
  await assert.rejects(lockNamed(filename));
  const repaired = join(root, 'repaired-runtime'); await mkdir(repaired);
  const repairedAnchor = join(repaired, 'package.json'); await writeFile(repairedAnchor, JSON.stringify({ name: 'synthetic-host' }));
  ctx.profileContext = { installAnchor: repairedAnchor };
  const backend = join(repaired, 'node_modules', '@deepseek-ai', 'dsh-session-persistence-jsonl'); await mkdir(backend, { recursive: true });
  await writeFile(join(backend, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-session-persistence-jsonl', main: './index.cjs' }));
  await writeFile(join(backend, 'index.cjs'), 'module.exports = {};');
  const koffi = join(root, 'node_modules', 'koffi'); await mkdir(koffi);
  await writeFile(join(koffi, 'package.json'), JSON.stringify({ name: 'koffi', type: 'module', main: './index.mjs' }));
  await writeFile(join(koffi, 'index.mjs'), 'export default { load() { return { func(_convention, name) { return () => name === "GetDriveTypeW" ? 3 : name === "WaitForSingleObject" ? 0 : 1; } }; } };');
  const held = await lockNamed(filename); await held.release();
});

async function idleLifecycleFixture() {
  const f = await fixture();
  const id = 'Private-owner'; await f.add(id);
  const session = { header: f.snapshots.get(id)!.header };
  const liveSessions = new Map([[id, session]]);
  const agent = { id, session, status: 'idle', phase: { kind: 'idle' } as unknown, inbox: { hasPending: false } as unknown };
  const liveAgents = new Map([[id, agent]]);
  const effect = Symbol('synthetic lifecycle effect');
  let disposed = 0; let flushed = 0;
  const dispose = Object.assign(() => { disposed++; liveSessions.delete(id); liveAgents.delete(id); },
    { [effect]: { label: `agentLoop.lifecycle(${id})` } });
  const fiber = { _disposables: new Set([dispose]) as unknown };
  const loopContext = { registry: { values: () => [{ fibers: new Set([fiber]) }] }, fiber };
  const loop = { runtime: { ctx: loopContext } };
  const agents = { get: (key: string) => liveAgents.get(key), list: (): unknown => [...liveAgents.values()],
    isOwnedBy: () => false, requireFactory: () => ({ target: loop }) };
  const sessionService = { get: (key: string) => liveSessions.get(key), flush: async () => { flushed++; return true; } };
  const warnings: string[] = [];
  Object.assign(f.ctx, { sessions: sessionService, agents, agentLoop: loop, fiber, logger: { warn: (message: string) => warnings.push(message) } });
  const adapter = await createDshAdapter(f.ctx, { home: f.home, version: '0.2.1-rc.3', platform: 'darwin', effectSymbol: effect, lockExclusive: async () => {} });
  const group = await adapter.inspect(id);
  return { ...f, adapter, group, agent, agents, loop, fiber, sessionService, liveSessions, liveAgents, warnings,
    disposed: () => disposed, flushed: () => flushed };
}

test('idle release still flushes and settles the verified native owner without diagnostic noise', async t => {
  const f = await idleLifecycleFixture(); t.after(f.cleanup);
  assert.equal(await f.adapter.releaseIdle!(f.group), true);
  assert.equal(f.flushed(), 1); assert.equal(f.disposed(), 1);
  assert.equal(f.liveSessions.size, 0); assert.equal(f.liveAgents.size, 0);
  assert.deepEqual(f.warnings, []);
});

test('missing idle-release capabilities have distinct bounded diagnostics and recover without replacing the adapter', async t => {
  const f = await idleLifecycleFixture(); t.after(f.cleanup);
  delete f.ctx.agents;
  assert.equal(await f.adapter.releaseIdle!(f.group), false);
  assert.equal(await f.adapter.releaseIdle!(f.group), false);
  assert.equal(f.warnings.length, 1); assert.match(f.warnings[0]!, /host=0\.2\.1-rc\.3 reason=agent-registry/);
  f.ctx.agents = f.agents; delete f.ctx.agentLoop;
  assert.equal(await f.adapter.releaseIdle!(f.group), false);
  assert.equal(f.warnings.length, 2); assert.match(f.warnings[1]!, /reason=agent-loop/);
  assert.equal(f.disposed(), 0); assert.equal(f.flushed(), 0);
  f.ctx.agentLoop = f.loop;
  assert.equal(await f.adapter.releaseIdle!(f.group), true);
  assert.equal(f.disposed(), 1); assert.equal(f.warnings.length, 2);
});

test('idle owner-shape refusals identify the failing probe without exposing session data or disposing an owner', async t => {
  const cases: [string, (f: Awaited<ReturnType<typeof idleLifecycleFixture>>) => void][] = [
    ['agent-inventory', f => { f.agents.list = () => ({}); }],
    ['agent-state', f => { f.agent.phase = undefined; }],
    ['lifecycle-disposables', f => { f.fiber._disposables = {}; }],
    ['lifecycle-owner-missing', f => { f.fiber._disposables = new Set([() => {}]); }],
  ];
  for (const [reason, change] of cases) await t.test(reason, async t => {
    const f = await idleLifecycleFixture(); t.after(f.cleanup); change(f);
    assert.equal(await f.adapter.releaseIdle!(f.group), false);
    assert.equal(await f.adapter.releaseIdle!(f.group), false);
    assert.equal(f.warnings.length, 1); assert.ok(f.warnings[0]!.includes(`reason=${reason}.`));
    for (const privateValue of ['Private', f.home, '/project', 'no session logs were moved']) assert.equal(f.warnings[0]!.includes(privateValue), false);
    assert.equal(f.liveSessions.size, 1); assert.equal(f.liveAgents.size, 1);
    assert.equal(f.disposed(), 0); assert.equal(f.flushed(), 0);
  });
});

test('a lost lifecycle probe during flush keeps the source-change guard and records the specific probe', async t => {
  const f = await idleLifecycleFixture(); t.after(f.cleanup);
  f.sessionService.flush = async () => { f.fiber._disposables = {}; return true; };
  await assert.rejects(f.adapter.releaseIdle!(f.group), { code: 'source-changed' });
  assert.equal(f.disposed(), 0); assert.equal(f.liveSessions.size, 1);
  assert.equal(f.warnings.length, 1); assert.match(f.warnings[0]!, /reason=lifecycle-disposables/);
});

test('routine active-session protection is not logged and a failing logger cannot authorize release', async t => {
  const active = await idleLifecycleFixture(); t.after(active.cleanup);
  active.agent.phase = { kind: 'maintenance' };
  await assert.rejects(active.adapter.releaseIdle!(active.group), { code: 'active' });
  assert.deepEqual(active.warnings, []); assert.equal(active.disposed(), 0);
  const unavailable = await idleLifecycleFixture(); t.after(unavailable.cleanup);
  unavailable.ctx.logger = { warn: () => { throw new Error('Private logger failure'); } };
  unavailable.fiber._disposables = {};
  assert.equal(await unavailable.adapter.releaseIdle!(unavailable.group), false);
  assert.equal(unavailable.disposed(), 0); assert.equal(unavailable.liveSessions.size, 1);
});
