import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { lstat, mkdir, open, readFile, readdir, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep, win32 } from 'node:path';
import {
  ArchiveError, SUPPORTED_DSH_VERSION,
  type Activity, type ArchivedSession, type DshAdapter, type JsonObject,
  type Lease, type LeaseResult, type SessionGroup, type SessionMember, type StorageWorkspace, type SupportStatus,
} from './contracts.js';
import { assertCanonicalStoragePath, assertLocalStoragePath, isWithin, samePath } from './filesystem.js';
import type { UsageRoot } from './storage-usage.js';

/** The small, version-pinned structural boundary around DSH's runtime services. */
interface Header extends JsonObject { id: string; version: number; createdAt: number }
interface Snapshot { header: Header; revision?: string; sizeBytes?: number; formatStatus?: string }
interface WorkspaceRecord { id: string; path: string; title?: string; sessionIds: string[]; updatedAt?: string }
interface WorkspaceState { workspaceIds: string[]; archivedSessionIds: string[]; pinnedSessionIds: string[]; [key: string]: unknown }
interface Table {
  get(id: string): WorkspaceRecord | undefined;
  update(id: string, update: (record: WorkspaceRecord) => WorkspaceRecord): Promise<WorkspaceRecord>;
}
interface Registry {
  archivedSessionIds: string[];
  requireState(): WorkspaceState;
  requireTable(): Table;
  enqueueOperation<T>(operation: () => Promise<T>): Promise<T>;
  indexHeader(header: JsonObject): Promise<void>;
  entities: Map<string, { record: WorkspaceRecord }>;
  headers: Map<string, unknown>;
  sessionPaths: Map<string, unknown>;
  missingSessionPaths: Set<string>;
  invalidSessionPaths: Map<string, unknown>;
  setState(state: WorkspaceState): Promise<void>;
}
interface Persistence {
  name: string;
  root: string;
  list(): Promise<Snapshot[]>;
  stat(id: string): Promise<Snapshot | undefined>;
  open(id: string, access: 'read'): Promise<{ header: Header; inheritedEventCount: number; read(): Promise<{ events: unknown[] }>; close(): Promise<void> }>;
  locate(header: JsonObject): { kind: string; path: string } | undefined;
  findLog?(id: string): Promise<{ sourcePath?: string } | undefined>;
}
interface Sessions { get(id: string): unknown; flush?(session: unknown): Promise<boolean> }
interface LiveAgent {
  id: string; session: { header: JsonObject }; status: string;
  phase: { kind: string }; inbox: { hasPending: boolean };
}
interface AgentRegistry {
  get(id: string): LiveAgent | undefined;
  list(): LiveAgent[];
  isOwnedBy(id: string, owner: LiveAgent): boolean;
  requireFactory(): { target: unknown };
}
interface NativeLifecycleSymbols { effect: symbol; original?: symbol }
interface ReleasePlan { id: string; session: unknown; agent: LiveAgent; dispose: () => unknown }
interface ProjectionCache {
  cachedSnapshot(header: JsonObject, keys?: string[]): { values: Record<string, unknown> } | undefined;
  cachedPredecessorTitle?(header: JsonObject): { values: Record<string, unknown> } | undefined;
  requireTable(): { delete(id: string): Promise<void> };
  put(id: string, identity: JsonObject, rows: unknown): Promise<void>;
}
export interface HostContext {
  get?(name: string): unknown;
  waterfall?(event: string, request: { sessionId: string }, next: () => Promise<unknown[]>): Promise<unknown[]>;
  emit?(event: string, ...args: unknown[]): unknown;
  logger?: { warn(message: string): void; info?(message: string): void };
  [key: string]: unknown;
}
export interface HostPaths { home: string; sessionsRoot: string; root: string }
export interface AdapterOptions {
  /** Test seams do not relax the published runtime's platform/version gate. */
  version?: string;
  platform?: string;
  home?: string;
  lockExclusive?: (fd: number) => Promise<void>;
  lockNamed?: (filename: string) => Promise<Lease>;
  /** Test seam for the live Cordis module's diagnostic effect symbol. */
  effectSymbol?: symbol;
}
const importHost = (specifier: string): Promise<Record<string, unknown>> => import(specifier) as Promise<Record<string, unknown>>;
const LOG_FILE = /^session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/;
const OWNED_FILE = /^(?:session(?:\.v\d+)?\.jsonl(?:\.zstd)?|session\.migration\.[A-Za-z0-9._-]+\.tmp|session(?:\.v\d+)?\.jsonl(?:\.zstd)?\.[a-fA-F0-9]+\.tmp|session\.lock)$/;

function service<T>(ctx: HostContext, name: string): T | undefined {
  const found = ctx.get?.(name);
  return (found === undefined ? ctx[name] : found) as T | undefined;
}
function code(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function headerId(value: unknown): value is Header {
  return object(value) && typeof value.id === 'string' && value.id.length > 0 && typeof value.version === 'number' && typeof value.createdAt === 'number';
}
function encodeId(value: string): string {
  if (value === '.') return '~002E';
  if (value === '..') return '~002E~002E';
  return value.replace(/[^A-Za-z0-9._-]/g, (character) => `~${character.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
}
function cloneHeader(header: Header): JsonObject { return JSON.parse(JSON.stringify(header)) as JsonObject; }
/** rc.3 writes an omitted live delegation depth as zero in its JSONL header. */
function sameSessionHeader(live: JsonObject, persisted: JsonObject): boolean {
  return isDeepStrictEqual({ ...live, delegationDepth: live.delegationDepth === undefined ? 0 : live.delegationDepth },
    { ...persisted, delegationDepth: persisted.delegationDepth === undefined ? 0 : persisted.delegationDepth });
}
/** Resolve primitives from the live installation: stock profiles do not auto-install peers. */
export function getNativeLockExclusive(ctx: HostContext): (fd: number) => Promise<void> {
  let implementation: Promise<(fd: number) => Promise<void>> | undefined;
  return async (fd) => {
    implementation ??= (async () => {
      const profile = service<{ installAnchor?: unknown }>(ctx, 'profileContext');
      if (typeof profile?.installAnchor !== 'string' || !isAbsolute(profile.installAnchor)) throw new ArchiveError('unsupported-host', 'The live DSH installation could not be resolved.');
      const filename = createRequire(profile.installAnchor).resolve('@deepseek-ai/node-addon-system/flock');
      const module = await importHost(pathToFileURL(filename).href);
      if (typeof module.tryLockExclusive !== 'function') throw new ArchiveError('unsupported-host', 'The native DSH write-lock capability is unavailable.');
      return module.tryLockExclusive as (descriptor: number) => Promise<void>;
    })();
    await (await implementation)(fd);
  };
}
type WindowsHandle = number | bigint;
interface WindowsSemaphoreApi {
  createSemaphore(attributes: null, initial: number, maximum: number, name: string): WindowsHandle;
  wait(handle: WindowsHandle, milliseconds: number): number;
  release(handle: WindowsHandle, count: number, previous: null): number;
  close(handle: WindowsHandle): number;
  lastError(): number;
  driveType(root: string): number;
}
/** Matches the running JSONL backend's case-insensitive, per-login Windows kernel identity. */
export function windowsSessionLockName(filename: string): string {
  return `Local\\dsh-session-lock-${createHash('sha256').update(win32.resolve(filename).toLowerCase()).digest('hex')}`;
}
export function isLocalWindowsDriveType(kind: number): boolean { return kind === 2 || kind === 3 || kind === 6; }
/** Windows ownership uses kernel objects, with no open file handle to obstruct a rename. */
export function getNativeWindowsLock(ctx: HostContext): (filename: string) => Promise<Lease> {
  let implementation: Promise<WindowsSemaphoreApi> | undefined;
  return async (filename) => {
    assertLocalStoragePath(filename);
    implementation ??= (async () => {
      const profile = service<{ installAnchor?: unknown }>(ctx, 'profileContext');
      if (typeof profile?.installAnchor !== 'string' || !isAbsolute(profile.installAnchor)) throw new ArchiveError('unsupported-host', 'The live DSH installation could not be resolved.');
      const backendFile = createRequire(profile.installAnchor).resolve('@deepseek-ai/dsh-session-persistence-jsonl');
      const koffiFile = createRequire(backendFile).resolve('koffi');
      const module = await importHost(pathToFileURL(koffiFile).href);
      const koffi = module.default as { load(name: string): { func(convention: string, name: string, result: string, args: string[]): unknown } };
      const kernel = koffi.load('kernel32.dll');
      return {
        createSemaphore: kernel.func('__stdcall', 'CreateSemaphoreW', 'intptr', ['void*', 'int', 'int', 'str16']),
        wait: kernel.func('__stdcall', 'WaitForSingleObject', 'uint', ['intptr', 'uint']),
        release: kernel.func('__stdcall', 'ReleaseSemaphore', 'int', ['intptr', 'int', 'void*']),
        close: kernel.func('__stdcall', 'CloseHandle', 'int', ['intptr']),
        lastError: kernel.func('__stdcall', 'GetLastError', 'uint', []),
        driveType: kernel.func('__stdcall', 'GetDriveTypeW', 'uint', ['str16']),
      } as WindowsSemaphoreApi;
    })();
    const api = await implementation;
    if (!isLocalWindowsDriveType(api.driveType(win32.parse(filename).root))) throw new ArchiveError('unsafe-path', 'Windows archive operations require a verified local writable drive.');
    const handle = api.createSemaphore(null, 1, 1, windowsSessionLockName(filename));
    if (handle === 0 || handle === 0n) throw Object.assign(new Error('The Windows kernel lock could not be created.'), { code: 'EIO', win32Code: api.lastError() });
    const acquired = api.wait(handle, 0);
    if (acquired !== 0) {
      const error = acquired === 258 ? { code: 'EBUSY' } : { code: 'EIO', win32Code: api.lastError() };
      api.close(handle);
      throw Object.assign(new Error('The Windows kernel lock is unavailable.'), error);
    }
    let released = false;
    return { release: async () => {
      if (released) return;
      released = true;
      const restored = api.release(handle, 1, null);
      const closed = api.close(handle);
      if (!restored || !closed) throw Object.assign(new Error('The Windows kernel lock could not be released.'), { code: 'EIO', win32Code: api.lastError() });
    } };
  };
}
async function nativeLockExclusive(fd: number): Promise<void> {
  const module = await importHost('@deepseek-ai/node-addon-system/flock');
  await (module.tryLockExclusive as (descriptor: number) => Promise<void>)(fd);
}

/** One Host owns recovery/restore/purge for a plugin store for its complete lifetime. */
export async function acquirePluginLease(root: string, lockExclusive: (fd: number) => Promise<void> = nativeLockExclusive, options: { platform?: string; lockNamed?: (filename: string) => Promise<Lease> } = {}): Promise<Lease> {
  assertLocalStoragePath(root);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const entry = await lstat(root);
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new ArchiveError('unsafe-path', 'The plugin data root is not a plain directory.');
  await assertCanonicalStoragePath(root);
  const filename = join(root, '.lock');
  if ((options.platform ?? process.platform) === 'win32') {
    if (!options.lockNamed) throw new ArchiveError('unsupported-host', 'The native Windows write-lock capability is unavailable.');
    try { return await options.lockNamed(filename); }
    catch (error) { if (code(error) === 'EBUSY') throw new ArchiveError('store-busy', 'Another DSH process owns this archive-delete store. Close that instance before enabling mutations here.'); throw error; }
  }
  const handle = await open(filename, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  try {
    await lockExclusive(handle.fd);
    const held = await handle.stat({ bigint: true });
    const current = await lstat(filename, { bigint: true });
    if (!current.isFile() || current.isSymbolicLink() || held.dev !== current.dev || held.ino !== current.ino) throw new ArchiveError('unsafe-lock', 'The plugin-store lock identity changed.');
    let released = false;
    return { release: async () => { if (!released) { released = true; await handle.close(); } } };
  } catch (error) {
    await handle.close();
    if (code(error) === 'EAGAIN' || code(error) === 'EWOULDBLOCK') throw new ArchiveError('store-busy', 'Another DSH process owns this archive-delete store. Close that instance before enabling mutations here.');
    throw error;
  }
}
function titleOf(cache: ProjectionCache | undefined, header: Header): string {
  const title = (cache?.cachedSnapshot(header, ['title']) ?? cache?.cachedPredecessorTitle?.(header))?.values.title;
  if (typeof title === 'string' && title.trim()) return title;
  if (object(title) && typeof title.title === 'string' && title.title.trim()) return title.title;
  return header.id;
}
function normalizeActivity(value: unknown): Activity {
  if (!object(value) || typeof value.kind !== 'string') return { kind: 'unknown', label: 'Unrecognized activity provider response' };
  const labels: string[] = [];
  for (const key of ['label', 'title', 'name']) if (typeof value[key] === 'string') labels.push(value[key]);
  if (Array.isArray(value.items)) for (const item of value.items) if (object(item) && typeof item.label === 'string') labels.push(item.label);
  return { kind: value.kind, label: labels.join(', ') || value.kind };
}

export async function getHostPaths(ctx: HostContext, homeOverride?: string): Promise<HostPaths> {
  let home: string;
  if (homeOverride !== undefined) home = resolve(homeOverride);
  else if (typeof service(ctx, 'dshHomePath') === 'function') home = resolve((service(ctx, 'dshHomePath') as () => string)());
  else {
    const homeModule = await importHost('@deepseek-ai/dsh-home-paths');
    home = resolve((homeModule.resolveDshHome as () => string)());
  }
  const persistence = service<Persistence>(ctx, 'sessionPersistence');
  const sessionsRoot = persistence && typeof persistence.root === 'string' && isAbsolute(persistence.root)
    ? resolve(persistence.root) : join(home, 'sessions');
  const root = join(home, 'archive-delete');
  for (const path of [home, sessionsRoot, root]) assertLocalStoragePath(path);
  return { home, sessionsRoot, root };
}

/** Storage views read only metadata already held by the host; no provider is opened. */
function storageService(ctx: HostContext, name: string): unknown {
  try { return service(ctx, name); } catch { return undefined; }
}
function storagePath(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.includes('\0') || !isAbsolute(value)) return undefined;
  try { assertLocalStoragePath(value); return resolve(value); } catch { return undefined; }
}
function registeredStorageWorkspace(ctx: HostContext, id: string): { id: string; title: string; path: unknown } | undefined {
  const registry = storageService(ctx, 'workspaceRegistry');
  if (!object(registry) || typeof registry.requireState !== 'function' || !(registry.entities instanceof Map)) return undefined;
  try {
    const state: unknown = registry.requireState();
    if (!object(state) || !Array.isArray(state.workspaceIds) || !state.workspaceIds.includes(id)) return undefined;
    const entity: unknown = registry.entities.get(id);
    if (!object(entity) || !object(entity.record)) return undefined;
    const record = entity.record;
    const title = typeof record.title === 'string' && record.title.trim() ? record.title
      : typeof record.path === 'string' ? basename(record.path) || 'Workspace' : 'Workspace';
    return { id, title, path: record.path };
  } catch { return undefined; }
}
/** Cheap registry-only enumeration. Paths never cross the API boundary. */
export function getStorageWorkspaces(ctx: HostContext): StorageWorkspace[] {
  const registry = storageService(ctx, 'workspaceRegistry');
  if (!object(registry) || typeof registry.requireState !== 'function') return [];
  try {
    const state: unknown = registry.requireState();
    if (!object(state) || !Array.isArray(state.workspaceIds)) return [];
    return [...new Set(state.workspaceIds)].flatMap((id: unknown) => {
      if (typeof id !== 'string' || !id || id.length > 512 || id.includes('\0')) return [];
      const entry = registeredStorageWorkspace(ctx, id);
      return entry ? [{ id, title: entry.title }] : [];
    });
  } catch { return []; }
}
/** Resolve current storage owners, including configured roots outside DSH_HOME. */
export async function getStorageSources(ctx: HostContext, workspaceId?: string): Promise<UsageRoot[]> {
  const profile = storageService(ctx, 'profileContext');
  let version = 'unknown';
  if (object(profile) && typeof profile.installAnchor === 'string' && isAbsolute(profile.installAnchor)) {
    try {
      const manifest: unknown = JSON.parse(await readFile(profile.installAnchor, 'utf8'));
      if (object(manifest) && manifest.name === '@deepseek-ai/dsh' && typeof manifest.version === 'string') version = manifest.version;
    } catch { /* Unknown layouts are not an invitation to guess storage roots. */ }
  }
  if (version !== SUPPORTED_DSH_VERSION) throw new ArchiveError('unsupported-host', `Storage inspection requires DSH ${SUPPORTED_DSH_VERSION}; the current runtime is ${version}.`);
  let home: string | undefined;
  const homeResolver = storageService(ctx, 'dshHomePath');
  if (typeof homeResolver === 'function') { try { home = storagePath(homeResolver()); } catch { /* Report unavailable below. */ } }
  const persistence = storageService(ctx, 'sessionPersistence');
  const attachments = storageService(ctx, 'attachments');
  const spill = storageService(ctx, 'spillStore');
  const query = storageService(ctx, 'sessionQuery');
  const storage = storageService(ctx, 'storage');
  let settings: unknown;
  try {
    if (object(storage) && object(storage.backend) && typeof storage.backend.get === 'function') settings = storage.backend.get('json');
  } catch { /* A missing backend stays unknown; do not initialize one. */ }
  const property = (owner: unknown, key: string): string | undefined => object(owner) ? storagePath(owner[key]) : undefined;
  const pluginRoot = home ? join(home, 'archive-delete') : undefined;
  const queryPath = object(query) && object(query.config) ? query.config.path : undefined;
  const root = (id: string, path: string | undefined, unavailableReason = 'root-unresolved'): UsageRoot =>
    ({ id, kind: id, readOnly: true, ...(path ? { path } : { unavailableReason }) });
  const roots: UsageRoot[] = [
    root('sessions', property(persistence, 'root')),
    ...['trash', 'staging', 'operations', 'receipts'].map(id => root(id, pluginRoot ? join(pluginRoot, id) : undefined)),
    root('attachments', property(attachments, 'root')),
    root('attachment-cache', property(attachments, 'cacheRoot')),
    root('cache', home ? join(home, 'cache') : undefined),
    root('settings', property(settings, 'root')),
    root('profiles', home ? join(home, 'profiles') : undefined),
    root('spill', property(spill, 'root')),
    { ...root('search', storagePath(queryPath), queryPath === ':memory:' ? 'in-memory' : 'root-unresolved'), file: true },
    root('other', home),
  ];
  // Every category owns its configured subtree. Parent summaries omit known
  // descendants, so cache and other do not count those paths a second time.
  for (const item of roots) if (item.path && !item.file) {
    const descendants = roots.flatMap(candidate => candidate.path && isWithin(item.path!, candidate.path) ? [candidate.path] : []);
    const excludes = [...new Set(descendants)].filter(path => !descendants.some(parent => parent !== path && isWithin(parent, path)));
    if (excludes.length) item.excludePaths = excludes;
  }
  const protectedPaths = [pluginRoot, ...roots.filter(item => item.id !== 'other').map(item => item.path)]
    .filter((path): path is string => path !== undefined);
  const isInternal = (path: string, boundary: string) => samePath(path, boundary) || isWithin(boundary, path);
  const userHome = resolve(homedir());
  const protectedWorkspace = (path: string) => samePath(path, parse(path).root) || samePath(path, userHome) || isWithin(path, userHome)
    || (home !== undefined && samePath(path, home)) || protectedPaths.some(boundary => isInternal(path, boundary));
  if (workspaceId === undefined) {
    // Registered project folders require an explicit workspace scan even when
    // they live below DSH_HOME. Metadata enumeration does not read the project.
    const projects = getStorageWorkspaces(ctx).flatMap(workspace => {
      const path = storagePath(registeredStorageWorkspace(ctx, workspace.id)?.path);
      return path && !protectedWorkspace(path) ? [path] : [];
    });
    for (const item of roots) if (item.path && !item.file) {
      const paths = [...(item.excludePaths ?? []), ...projects.filter(path => isWithin(item.path!, path))];
      const minimal = [...new Set(paths)].filter(path => !paths.some(parent => parent !== path && isWithin(parent, path)));
      if (minimal.length) item.excludePaths = minimal;
    }
    return roots;
  }
  if (!workspaceId || workspaceId.length > 512 || workspaceId.includes('\0')) throw new ArchiveError('invalid-request', 'A registered workspace ID is required.');
  const selected = registeredStorageWorkspace(ctx, workspaceId);
  if (!selected) throw new ArchiveError('workspace-not-found', 'The selected workspace is no longer registered.');
  const selectedPath = storagePath(selected.path);
  if (!selectedPath) throw new ArchiveError('unsafe-workspace', 'The selected workspace does not have a safe absolute path.');
  if (protectedWorkspace(selectedPath))
    throw new ArchiveError('unsafe-workspace', 'Select a project directory outside protected host storage.');
  const exclusions = [...protectedPaths, ...(home ? [home] : [])].filter(path => isWithin(selectedPath, path));
  try {
    const entry = await lstat(selectedPath);
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new ArchiveError('unsafe-workspace', 'The selected workspace must be a plain project directory.');
    const canonical = await realpath(selectedPath);
    await assertCanonicalStoragePath(selectedPath, canonical);
    if (!samePath(selectedPath, canonical)) throw new ArchiveError('unsafe-workspace', 'The selected workspace path redirects through a symbolic link.');
    for (const path of protectedPaths) {
      let boundary = path;
      try { boundary = await realpath(path); } catch { /* Keep the registered lexical boundary when absent. */ }
      if (isInternal(canonical, boundary)) throw new ArchiveError('unsafe-workspace', 'The selected workspace is inside protected host storage.');
      if (isWithin(canonical, boundary)) exclusions.push(boundary);
    }
  } catch (error) {
    // A missing project is reported as missing by the scanner, never created.
    if (code(error) !== 'ENOENT') throw error;
  }
  const current = registeredStorageWorkspace(ctx, workspaceId);
  if (!current || current.path !== selected.path) throw new ArchiveError('workspace-changed', 'The selected workspace changed. Select it again and rescan.');
  const excludePaths = [...new Set(exclusions)].filter(path => !exclusions.some(parent => parent !== path && isWithin(parent, path)));
  return [{ id: 'workspace', kind: 'workspace', label: selected.title, path: selectedPath, readOnly: true,
    ...(excludePaths.length ? { excludePaths } : {}) }];
}

/** Create the sole layer allowed to inspect DSH internals. It never installs or replaces services. */
export async function createDshAdapter(ctx: HostContext, options: AdapterOptions = {}): Promise<DshAdapter> {
  let version = options.version;
  if (version === undefined) {
    const profile = service<{ installAnchor?: unknown }>(ctx, 'profileContext');
    version = 'unknown';
    if (typeof profile?.installAnchor === 'string' && isAbsolute(profile.installAnchor)) {
      const manifest: unknown = JSON.parse(await readFile(profile.installAnchor, 'utf8'));
      if (object(manifest) && manifest.name === '@deepseek-ai/dsh' && typeof manifest.version === 'string') version = manifest.version;
    }
  }
  const paths = await getHostPaths(ctx, options.home);
  const lockExclusive = options.lockExclusive ?? getNativeLockExclusive(ctx);
  return new NativeAdapter(ctx, paths, version, options.platform ?? process.platform, lockExclusive, options.lockNamed ?? getNativeWindowsLock(ctx), options.effectSymbol);
}

class NativeAdapter implements DshAdapter {
  private readonly persistence: Persistence | undefined;
  private readonly registry: Registry | undefined;
  private readonly sessions: Sessions | undefined;
  private readonly cache: ProjectionCache | undefined;
  constructor(private readonly ctx: HostContext, private readonly paths: HostPaths,
    private readonly version: string, private readonly platform: string,
    private readonly lockExclusive: (fd: number) => Promise<void>,
    private readonly lockNamed: (filename: string) => Promise<Lease>, private readonly effectSymbol?: symbol) {
    this.persistence = service(ctx, 'sessionPersistence');
    this.registry = service(ctx, 'workspaceRegistry');
    this.sessions = service(ctx, 'sessions');
    this.cache = service(ctx, 'sessionProjectionCache');
  }
  async capabilities(): Promise<SupportStatus> {
    let reason: string | undefined;
    if (this.platform !== 'darwin' && this.platform !== 'win32') reason = 'Only macOS and Windows Desktop are supported in this release.';
    else if (this.version !== SUPPORTED_DSH_VERSION) reason = `DSH Desktop ${SUPPORTED_DSH_VERSION} is required; the current runtime is ${this.version}. Update DSH Desktop to the required version, then restart this plugin.`;
    else if (this.persistence?.name !== 'session-persistence-jsonl' || !isAbsolute(this.persistence.root)) reason = 'The official JSONL session backend is required.';
    else if (!this.sessions || typeof this.sessions.get !== 'function' || !this.ctx.waterfall || !this.ctx.emit) reason = 'Session activity and lifecycle services are unavailable.';
    else if (!this.registry || !['requireState', 'requireTable', 'enqueueOperation', 'setState', 'indexHeader'].every((key) => typeof (this.registry as unknown as Record<string, unknown>)[key] === 'function')
      || !(this.registry.headers instanceof Map) || !(this.registry.sessionPaths instanceof Map) || !(this.registry.missingSessionPaths instanceof Set) || !(this.registry.invalidSessionPaths instanceof Map)) reason = 'The DSH workspace adapter is incompatible.';
    else if (!this.cache || typeof this.cache.requireTable !== 'function' || typeof this.cache.cachedSnapshot !== 'function' || typeof this.cache.put !== 'function' || !service<{ restore?: unknown }>(this.ctx, 'sessionProjections')?.restore || typeof this.persistence.open !== 'function') reason = 'The official projection-cache service is unavailable.';
    return { supported: reason === undefined, version: this.version, platform: this.platform, ...(reason ? { reason } : {}) };
  }
  private async requireSupported(): Promise<void> {
    const support = await this.capabilities();
    if (!support.supported) throw new ArchiveError('unsupported-host', support.reason ?? 'Unsupported host');
  }
  private async lifecycleSymbols(): Promise<NativeLifecycleSymbols | undefined> {
    if (this.effectSymbol) return { effect: this.effectSymbol };
    const profile = service<{ installAnchor?: unknown }>(this.ctx, 'profileContext');
    if (typeof profile?.installAnchor !== 'string' || !isAbsolute(profile.installAnchor)) return undefined;
    try {
      const filename = createRequire(profile.installAnchor).resolve('@deepseek-ai/cordis');
      const module = await importHost(pathToFileURL(filename).href);
      const symbols = module.symbols;
      if (!object(symbols) || typeof symbols.effect !== 'symbol') return undefined;
      return { effect: symbols.effect, ...(typeof symbols.original === 'symbol' ? { original: symbols.original } : {}) };
    } catch { return undefined; }
  }
  /** Invoke only the exact rc.3 owner teardown; never close a borrowed writer or edit registries. */
  async releaseIdle(group: SessionGroup): Promise<boolean> {
    await this.requireSupported();
    if (group.members.every(member => this.sessions!.get(member.id) === undefined)) return true;
    const symbols = await this.lifecycleSymbols();
    const agents = service<AgentRegistry>(this.ctx, 'agents');
    const loop = service<Record<string, unknown>>(this.ctx, 'agentLoop');
    if (!symbols || !agents || !loop || typeof this.sessions!.flush !== 'function'
      || !['get', 'list', 'isOwnedBy', 'requireFactory'].every(key => typeof (agents as unknown as Record<string, unknown>)[key] === 'function')) return false;
    let factory: unknown;
    try { factory = agents.requireFactory().target; } catch { return false; }
    const originalLoop = symbols.original ? (loop as Record<symbol, unknown>)[symbols.original] ?? loop : loop;
    if (originalLoop !== factory || !object(factory) || !object(factory.runtime) || !object(factory.runtime.ctx)) return false;
    const loopContext = factory.runtime.ctx;
    const registry = loopContext.registry;
    if (!object(registry) || typeof registry.values !== 'function') return false;
    const fibers = new Set<Record<string, unknown>>();
    const ancestors = (candidate: unknown) => {
      while (object(candidate) && !fibers.has(candidate)) {
        fibers.add(candidate); candidate = object(candidate.parent) ? candidate.parent.fiber : undefined;
      }
    };
    ancestors(this.ctx.fiber); ancestors(loopContext.fiber);
    try {
      for (const runtime of (registry.values as () => Iterable<unknown>).call(registry)) {
        if (!object(runtime) || !object(runtime.fibers) || typeof (runtime.fibers as Record<symbol, unknown>)[Symbol.iterator] !== 'function') return false;
        for (const fiber of runtime.fibers as unknown as Iterable<unknown>) ancestors(fiber);
      }
    } catch { return false; }
    const rootArchived = () => {
      if (!this.registry!.archivedSessionIds.includes(group.sessionId)) throw new ArchiveError('not-archived', 'Only archived sessions can be released for trash.');
    };
    const inspectPlan = (): ReleasePlan[] | undefined => {
      rootArchived();
      const plans: ReleasePlan[] = []; const ids = new Set(group.members.map(member => member.id));
      const live = agents.list();
      if (!Array.isArray(live) || live.some(agent => !object(agent) || typeof agent.id !== 'string')) return undefined;
      for (const member of group.members) {
        const session = this.sessions!.get(member.id); const agent = agents.get(member.id);
        if (session === undefined) {
          if (agent !== undefined) throw new ArchiveError('ambiguous-lifecycle', 'The host agent and session lifecycles disagree.');
          continue;
        }
        if (!agent || !object(agent.phase) || !object(agent.inbox)) return undefined;
        if (agent.session !== session || agent.id !== member.id || !sameSessionHeader(agent.session.header, member.header))
          throw new ArchiveError('source-changed', 'The loaded session identity changed. Review a new preview.');
        // The public status also calls maintenance idle. The actual phase and
        // durable inbox are both required before a teardown that cancels input.
        if (agent.status !== 'idle' || agent.phase.kind !== 'idle' || agent.inbox.hasPending !== false)
          throw new ArchiveError('active', 'A session has active maintenance or queued input. Nothing was released.');
        if (live.some(child => !ids.has(child.id) && agents.isOwnedBy(child.id, agent)))
          throw new ArchiveError('ambiguous-lineage', 'The host owns a child outside the confirmed session group.');
        const matches = new Set<() => unknown>();
        for (const fiber of fibers) {
          const disposables = fiber._disposables;
          if (!object(disposables) || typeof (disposables as Record<symbol, unknown>)[Symbol.iterator] !== 'function') return undefined;
          for (const dispose of disposables as unknown as Iterable<unknown>) {
            if (typeof dispose !== 'function') continue;
            const metadata = (dispose as unknown as Record<symbol, unknown>)[symbols.effect];
            if (object(metadata) && metadata.label === `agentLoop.lifecycle(${member.id})`) matches.add(dispose as () => unknown);
          }
        }
        if (!matches.size) return undefined;
        if (matches.size !== 1) throw new ArchiveError('ambiguous-lifecycle', 'Multiple host owners claim this session lifecycle. Nothing was released.');
        plans.push({ id: member.id, session, agent, dispose: [...matches][0]! });
      }
      // Claim children first; every native teardown is awaited before return.
      const ordered: ReleasePlan[] = [];
      while (plans.length) {
        const leaf = plans.findIndex(parent => !plans.some(child => child !== parent && agents.isOwnedBy(child.id, parent.agent)));
        if (leaf < 0) throw new ArchiveError('ambiguous-lineage', 'The host runtime ownership graph is cyclic.');
        ordered.push(plans.splice(leaf, 1)[0]!);
      }
      return ordered;
    };
    const checkActivity = async () => {
      rootArchived();
      for (const member of group.members) {
        if ((await this.ctx.waterfall!('workspace/session-activity', { sessionId: member.id }, async () => [])).length)
          throw new ArchiveError('active', 'A session or related task is active. Nothing was released.');
      }
    };
    await checkActivity();
    const prepared = inspectPlan(); if (prepared === undefined) return false;
    for (const plan of prepared) await this.sessions!.flush!(plan.session);
    await checkActivity();
    // No await between the final identity/idle checks and claiming every native
    // owner disposer. Each native teardown memoizes its own ordered settlement.
    const current = inspectPlan();
    if (!current || current.length !== prepared.length || current.some((plan, index) => plan.agent !== prepared[index]!.agent
      || plan.session !== prepared[index]!.session || plan.dispose !== prepared[index]!.dispose))
      throw new ArchiveError('source-changed', 'A session lifecycle changed while release was being prepared.');
    const settlements = await Promise.allSettled(current.map(plan => {
      try { return Promise.resolve(plan.dispose()); } catch (error) { return Promise.reject(error); }
    }));
    if (settlements.some(settlement => settlement.status === 'rejected') || group.members.some(member => this.sessions!.get(member.id) !== undefined || agents.get(member.id) !== undefined))
      throw new ArchiveError('release-failed', 'The host could not finish releasing this idle session. Its logs have not been moved.');
    return true;
  }
  private async snapshots(): Promise<Snapshot[]> {
    const snapshots = await this.persistence!.list();
    const ids = new Set<string>();
    for (const snapshot of snapshots) {
      if (!headerId(snapshot.header) || ids.has(snapshot.header.id)) throw new ArchiveError('invalid-session', 'Session identity is missing or duplicated.');
      ids.add(snapshot.header.id);
    }
    return snapshots;
  }
  async listArchived(): Promise<ArchivedSession[]> {
    await this.requireSupported();
    const snapshots = await this.snapshots();
    const archived = new Set(this.registry!.archivedSessionIds);
    const records = this.registry!.requireState().workspaceIds.map((id) => this.registry!.requireTable().get(id)).filter((record): record is WorkspaceRecord => record !== undefined);
    return snapshots.filter(({ header }) => archived.has(header.id) && header.origin !== 'subagent').map(({ header, sizeBytes }) => {
      const children = this.descendants(header.id, snapshots, false);
      const workspace = records.find((record) => record.sessionIds.includes(header.id));
      return { id: header.id, title: titleOf(this.cache, header), workspace: workspace?.title ?? workspace?.path ?? 'Ungrouped',
        sizeBytes: (sizeBytes ?? 0) + children.reduce((sum, child) => sum + (child.sizeBytes ?? 0), 0), descendantCount: children.length };
    });
  }
  /** Only explicit subagent ancestry is owned; a fork's parent pointer is not ownership. */
  private descendants(id: string, snapshots: Snapshot[], strict = true): Snapshot[] {
    const visited = new Set([id]);
    const result: Snapshot[] = [];
    const walk = (parent: string) => {
      for (const snapshot of snapshots) {
        if (snapshot.header.parentSession !== parent || snapshot.header.origin !== 'subagent') continue;
        if (visited.has(snapshot.header.id)) {
          if (strict) throw new ArchiveError('ambiguous-lineage', 'Cyclic subagent ownership prevents safe cleanup.');
          continue;
        }
        visited.add(snapshot.header.id); result.push(snapshot); walk(snapshot.header.id);
      }
    };
    walk(id);
    return result;
  }
  async inspect(sessionId: string): Promise<SessionGroup> {
    await this.requireSupported();
    const snapshots = await this.snapshots();
    const root = snapshots.find(({ header }) => header.id === sessionId);
    if (!root) throw new ArchiveError('session-missing', 'The session no longer exists.');
    if (root.header.origin === 'subagent') throw new ArchiveError('subagent-target', 'Move the parent conversation instead of an individual subagent.');
    const selected = [root, ...this.descendants(sessionId, snapshots)];
    const byId = new Map(snapshots.map((snapshot) => [snapshot.header.id, snapshot.header]));
    for (const snapshot of selected) {
      const ancestry = new Set<string>();
      let header: Header | undefined = snapshot.header;
      while (header) {
        if (ancestry.has(header.id)) throw new ArchiveError('ambiguous-lineage', 'Cyclic session ancestry prevents safe cleanup.');
        ancestry.add(header.id);
        header = typeof header.parentSession === 'string' ? byId.get(header.parentSession) : undefined;
      }
    }
    const ids = new Set(selected.map(({ header }) => header.id));
    for (const snapshot of snapshots) {
      if (!ids.has(snapshot.header.id) && typeof snapshot.header.parentSession === 'string' && ids.has(snapshot.header.parentSession)) {
        if (snapshot.header.origin !== undefined || snapshot.header.isSeeded !== true || snapshot.formatStatus !== 'current') {
          throw new ArchiveError('dependent-session', 'A legacy or ambiguous descendant may still depend on this conversation. Restore or migrate it before cleanup.');
        }
      }
    }
    const members: SessionMember[] = [];
    for (const snapshot of selected) members.push(await this.member(snapshot));
    return { sessionId, title: members[0]!.title, sessionsRoot: this.paths.sessionsRoot, members };
  }
  private async member(snapshot: Snapshot): Promise<SessionMember> {
    const { header } = snapshot;
    const location = this.persistence!.locate(header);
    if (location?.kind !== 'jsonl' || !isAbsolute(location.path) || !LOG_FILE.test(basename(location.path))) throw new ArchiveError('unsupported-layout', 'The session artifact cannot be located safely.');
    const directory = dirname(location.path);
    await this.validateDirectory(directory, header.id);
    const filenames = (await readdir(directory)).sort();
    const fingerprint: string[] = [];
    let sizeBytes = 0;
    for (const filename of filenames) {
      const file = await lstat(join(directory, filename), { bigint: true });
      if (!file.isFile() || file.isSymbolicLink() || !OWNED_FILE.test(filename)) throw new ArchiveError('unknown-artifact', 'Unexpected files prevent safe cleanup.');
      if (filename === 'session.lock') continue;
      sizeBytes += Number(file.size);
      fingerprint.push(`${filename}:${file.dev}:${file.ino}:${file.size}:${file.mtimeNs}`);
    }
    if (!filenames.some((filename) => LOG_FILE.test(filename))) throw new ArchiveError('session-missing', 'No session log remains.');
    const revision = createHash('sha256').update(JSON.stringify(header)).update('\0').update(fingerprint.join('\n')).digest('hex');
    const state = this.registry!.requireState();
    const accounts = state.workspaceIds.map((id) => ({ id, record: this.registry!.requireTable().get(id) })).filter(({ record }) => record?.sessionIds.includes(header.id));
    if (accounts.length > 1) throw new ArchiveError('ambiguous-workspace', 'A session is registered in multiple workspaces.');
    const account = accounts[0];
    const activity = (await this.ctx.waterfall!('workspace/session-activity', { sessionId: header.id }, async () => [])).map(normalizeActivity);
    return { id: header.id, title: titleOf(this.cache, header), directory, revision, header: cloneHeader(header),
      ...(account?.record ? { workspaceId: account.id, workspacePath: account.record.path, accountIndex: account.record.sessionIds.indexOf(header.id) } : {}),
      archived: state.archivedSessionIds.includes(header.id), pinned: state.pinnedSessionIds.includes(header.id),
      loaded: this.sessions!.get(header.id) !== undefined, activity, sizeBytes };
  }
  private async validateDirectory(directory: string, sessionId: string): Promise<void> {
    const root = resolve(this.paths.sessionsRoot);
    assertLocalStoragePath(directory);
    const rel = relative(root, resolve(directory));
    const segments = rel.split(sep);
    if (!rel || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel) || segments.length !== 2 || basename(directory) !== encodeId(sessionId)) throw new ArchiveError('unsafe-path', 'Session storage ownership could not be verified.');
    const project = dirname(directory);
    for (const path of [root, project, directory]) {
      const entry = await lstat(path);
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new ArchiveError('unsafe-path', 'Symbolic links or non-directory session paths are not supported.');
    }
    const canonicalRoot = await realpath(root);
    const canonicalDirectory = await realpath(directory);
    assertLocalStoragePath(canonicalRoot); assertLocalStoragePath(canonicalDirectory);
    await assertCanonicalStoragePath(root, canonicalRoot); await assertCanonicalStoragePath(directory, canonicalDirectory);
    if (!samePath(canonicalDirectory, join(canonicalRoot, rel))) throw new ArchiveError('unsafe-path', 'Session path changed during inspection.');
  }
  async acquire(group: SessionGroup): Promise<LeaseResult> {
    await this.requireSupported();
    for (const member of group.members) await this.validateDirectory(member.directory, member.id);
    return this.acquireLocated(group, group.members.map((member) => member.directory));
  }
  /** Trusted storage supplies validated source/staging/trash locations, never browser paths. */
  async acquireLocated(group: SessionGroup, directories: (string | undefined)[]): Promise<LeaseResult> {
    await this.requireSupported();
    if (directories.length !== group.members.length || new Set(directories.filter((directory) => directory !== undefined)).size !== directories.filter((directory) => directory !== undefined).length) throw new ArchiveError('unsafe-path', 'The recovery locations do not match this session group.');
    const loaded = new Set(group.members.filter(({ id }) => this.sessions!.get(id) !== undefined).map(({ id }) => id));
    if (this.platform === 'win32') return this.acquireWindowsLocated(group, directories, loaded);
    const handles: Awaited<ReturnType<typeof open>>[] = [];
    try {
      const targets = group.members.map((member, index) => ({ member, directory: directories[index] })).sort((a, b) => a.member.id.localeCompare(b.member.id));
      for (const { member, directory } of targets) {
        assertLocalStoragePath(member.directory);
        if (directory !== undefined) assertLocalStoragePath(directory);
        const activity = await this.ctx.waterfall!('workspace/session-activity', { sessionId: member.id }, async () => []);
        if (activity.length) { await Promise.allSettled(handles.map((handle) => handle.close())); return { kind: 'busy', message: 'A session or related task is active.' }; }
        // Loaded writers belong to this process. Probe every cold member before accepting a pending group.
        if (loaded.has(member.id) || directory === undefined) continue;
        const entry = await lstat(directory);
        if (!isAbsolute(directory) || !entry.isDirectory() || entry.isSymbolicLink()) throw new ArchiveError('unsafe-path', 'A recovery location is not a plain canonical directory.');
        const filename = join(directory, 'session.lock');
        const handle = await open(filename, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
        handles.push(handle);
        await this.lockExclusive(handle.fd);
        const held = await handle.stat({ bigint: true });
        const current = await lstat(filename, { bigint: true });
        if (!current.isFile() || current.isSymbolicLink() || held.dev !== current.dev || held.ino !== current.ino) throw new ArchiveError('unsafe-lock', 'The session write-lock identity changed.');
      }
      if (loaded.size) { await Promise.allSettled(handles.map((handle) => handle.close())); return { kind: 'loaded', message: 'An idle session is still held by this DSH process.' }; }
      let released = false;
      return { kind: 'acquired', lease: { release: async () => {
        if (released) return;
        released = true;
        const settled = await Promise.allSettled(handles.map((handle) => handle.close()));
        const failure = settled.find((result) => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
      } } };
    } catch (error) {
      await Promise.allSettled(handles.map((handle) => handle.close()));
      if (code(error) === 'EAGAIN' || code(error) === 'EWOULDBLOCK') return { kind: 'busy', message: 'Another process holds the session write lock.' };
      throw error;
    }
  }
  private async acquireWindowsLocated(group: SessionGroup, directories: (string | undefined)[], loaded: Set<string>): Promise<LeaseResult> {
    const leases: Lease[] = [];
    const release = async () => {
      const results = await Promise.allSettled(leases.map((lease) => lease.release()));
      const failure = results.find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
    };
    try {
      const targets = group.members.map((member, index) => ({ member, directory: directories[index] })).sort((a, b) => a.member.id.localeCompare(b.member.id));
      const heldNames = new Set<string>();
      for (const { member, directory } of targets) {
        assertLocalStoragePath(member.directory);
        if (directory !== undefined) assertLocalStoragePath(directory);
        const activity = await this.ctx.waterfall!('workspace/session-activity', { sessionId: member.id }, async () => []);
        if (activity.length) { await release(); return { kind: 'busy', message: 'A session or related task is active.' }; }
        if (loaded.has(member.id)) continue;
        if (directory !== undefined) {
          const entry = await lstat(directory);
          if (!isAbsolute(directory) || !entry.isDirectory() || entry.isSymbolicLink()) throw new ArchiveError('unsafe-path', 'A recovery location is not a plain directory.');
        }
        // Windows locks name paths rather than inodes: reserve the original destination
        // throughout restore/rollback as well as the currently located artifact.
        for (const path of [member.directory, directory]) {
          if (path === undefined) continue;
          const filename = join(path, 'session.lock'); const name = windowsSessionLockName(filename);
          if (heldNames.has(name)) continue;
          leases.push(await this.lockNamed(filename)); heldNames.add(name);
        }
      }
      if (loaded.size) { await release(); return { kind: 'loaded', message: 'An idle session is still held by this DSH process.' }; }
      let released = false;
      return { kind: 'acquired', lease: { release: async () => { if (!released) { released = true; await release(); } } } };
    } catch (error) {
      await release().catch(() => {});
      if (code(error) === 'EBUSY') return { kind: 'busy', message: 'Another process holds the session write lock.' };
      throw error;
    }
  }
  private async restoreProjections(member: SessionMember): Promise<void> {
    const reader = await this.persistence!.open(member.id, 'read');
    try {
      if (JSON.stringify(reader.header) !== JSON.stringify(member.header)) throw new ArchiveError('restore-identity', 'Restored session identity changed before projection recovery.');
      const { events } = await reader.read();
      const registry = service<{ restore(rows: object, events: unknown[], base: number, header: Header, inherited: number): { checkpoint: unknown } }>(this.ctx, 'sessionProjections')!;
      const restored = registry.restore({}, events, 0, reader.header, reader.inheritedEventCount);
      const header = reader.header;
      await this.cache!.put(member.id, { formatVersion: header.version, createdAt: header.createdAt, ...(header.cwd === undefined ? {} : { cwd: header.cwd }), isSeeded: header.isSeeded ?? false, inheritedEventCount: reader.inheritedEventCount }, restored.checkpoint);
    } finally { await reader.close(); }
  }
  async removeRegistry(group: SessionGroup): Promise<void> {
    await this.requireSupported();
    if (group.members.some(({ id }) => this.sessions!.get(id) !== undefined)) throw new ArchiveError('session-loaded', 'A session became loaded before its registry could be updated.');
    const ids = new Set(group.members.map(({ id }) => id));
    await this.registry!.enqueueOperation(async () => {
      const table = this.registry!.requireTable();
      for (const workspaceId of this.registry!.requireState().workspaceIds) {
        if (!table.get(workspaceId)?.sessionIds.some((id) => ids.has(id))) continue;
        const record = await table.update(workspaceId, (current) => ({ ...current, sessionIds: current.sessionIds.filter((id) => !ids.has(id)), updatedAt: new Date().toISOString() }));
        const entity = this.registry!.entities.get(workspaceId);
        if (entity) entity.record = record;
      }
      const state = this.registry!.requireState();
      await this.registry!.setState({ ...state, archivedSessionIds: state.archivedSessionIds.filter((id) => !ids.has(id)), pinnedSessionIds: state.pinnedSessionIds.filter((id) => !ids.has(id)) });
      for (const id of ids) {
        await this.cache!.requireTable().delete(id);
        this.registry!.headers.delete(id); this.registry!.sessionPaths.delete(id);
        this.registry!.missingSessionPaths.delete(id); this.registry!.invalidSessionPaths.delete(id);
      }
    });
    for (const id of ids) this.ctx.emit!('api-session/removed', id);
  }
  async restoreRegistry(group: SessionGroup): Promise<void> {
    await this.requireSupported();
    const restored: { member: SessionMember; snapshot: Snapshot }[] = [];
    for (const member of group.members) {
      const snapshot = await this.persistence!.stat(member.id);
      if (!snapshot || JSON.stringify(snapshot.header) !== JSON.stringify(member.header)) throw new ArchiveError('restore-identity', 'Restored session identity does not match the recorded session.');
      await this.restoreProjections(member);
      restored.push({ member, snapshot });
    }
    await this.registry!.enqueueOperation(async () => {
      const table = this.registry!.requireTable();
      for (const { member, snapshot } of restored) {
        await this.registry!.indexHeader(snapshot.header);
        const account = member.workspaceId ? table.get(member.workspaceId) : undefined;
        if (member.workspaceId && account && account.path === member.workspacePath) {
          const record = await table.update(member.workspaceId, (current) => {
            if (current.sessionIds.includes(member.id)) return current;
            const sessionIds = [...current.sessionIds];
            sessionIds.splice(Math.min(Math.max(member.accountIndex ?? sessionIds.length, 0), sessionIds.length), 0, member.id);
            return { ...current, sessionIds, updatedAt: new Date().toISOString() };
          });
          const entity = this.registry!.entities.get(member.workspaceId);
          if (entity) entity.record = record;
        }
      }
      const state = this.registry!.requireState();
      const archived = new Set(state.archivedSessionIds);
      // The selected root always returns to archived; descendants retain their prior archive state.
      for (const { member } of restored) if (member.id === group.sessionId || member.archived) archived.add(member.id);
      const pinned = new Set(state.pinnedSessionIds.filter((id) => !archived.has(id)));
      for (const { member } of restored) if (member.pinned && !archived.has(member.id)) pinned.add(member.id);
      await this.registry!.setState({ ...state, archivedSessionIds: [...archived], pinnedSessionIds: [...pinned] });
    });
    for (const { member, snapshot } of restored) {
      const header = snapshot.header;
      const projections = this.cache?.cachedSnapshot(header);
      // A metadata-only native list summary restores visibility without creating an Agent or rewriting logs.
      this.ctx.emit!('api-session/added', {
        sessionId: member.id, updatedAt: header.createdAt, agentAvailable: false, running: false, blank: false,
        ...(snapshot.formatStatus ? { formatStatus: snapshot.formatStatus } : {}),
        ...(typeof header.cwd === 'string' ? { cwd: header.cwd } : {}),
        ...(typeof header.parentSession === 'string' ? { parentSessionId: header.parentSession } : {}),
        ...(typeof header.origin === 'string' ? { origin: header.origin } : {}),
        projections: { kind: 'cached', asOfSeq: 0, values: { ...(projections?.values ?? {}), title: member.title } },
      });
    }
  }
}
