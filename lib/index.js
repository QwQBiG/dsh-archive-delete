// src/index.ts
import { join as join7 } from "node:path";

// src/contracts.ts
var PACKAGE_NAME = "@qwqbig/dsh-archive-delete";
var API_PATH = "/api/dsh-archive-delete";
var SUPPORTED_DSH_VERSION = "0.2.1-rc.3";
var SUPPORTED_DSH_VERSIONS = [SUPPORTED_DSH_VERSION, "0.2.1-rc.5"];
var SUPPORTED_DSH_VERSION_LABEL = SUPPORTED_DSH_VERSIONS.join(" / ");
function isSupportedDshVersion(version) {
  return SUPPORTED_DSH_VERSIONS.includes(version);
}
var ArchiveError = class extends Error {
  constructor(code3, message) {
    super(message);
    this.code = code3;
    this.name = "ArchiveError";
  }
};

// src/dsh-adapter.ts
import { createHash } from "node:crypto";
import { constants as constants2 } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { lstat as lstat2, mkdir, open as open2, readFile, readdir, realpath as realpath2 } from "node:fs/promises";
import { basename, dirname, isAbsolute as isAbsolute2, join, parse, relative as relative2, resolve as resolve2, sep as sep2, win32 as win322 } from "node:path";

// src/filesystem.ts
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep, win32 } from "node:path";
function samePath(left, right) {
  return relative(resolve(left), resolve(right)) === "";
}
function isWithin(root, path) {
  const part = relative(resolve(root), resolve(path));
  return part !== "" && part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part);
}
function assertLocalStoragePath(path, platform = process.platform) {
  if (platform !== "win32") {
    if (!isAbsolute(path)) throw new ArchiveError("unsafe-path", "Storage paths must be absolute.");
    return;
  }
  const root = win32.parse(path).root;
  if (!/^[A-Za-z]:[\\/]$/.test(root) || !win32.isAbsolute(path))
    throw new ArchiveError("unsafe-path", "Windows storage requires a local absolute drive path.");
  const parts = path.slice(root.length).split(/[\\/]/);
  if (parts.some((part) => part === "." || part === ".." || /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part)))
    throw new ArchiveError("unsafe-path", "Windows storage contains a device name or ambiguous path.");
}
async function assertPlainDirectory(path) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ArchiveError("unsafe-path", "A data directory is not a plain directory.");
}
async function assertCanonicalStoragePath(path, canonical, platform = process.platform) {
  if (platform !== "win32") return;
  const physical = canonical ?? await realpath(path);
  assertLocalStoragePath(path, platform);
  assertLocalStoragePath(physical, platform);
  if (win32.relative(win32.resolve(path), win32.resolve(physical)) !== "")
    throw new ArchiveError("unsafe-path", "Windows storage paths must use their canonical local path, without junction or short-name aliases.");
}
async function assertPrivateDirectory(path) {
  await assertPlainDirectory(path);
  const stat = await lstat(path);
  if (process.platform !== "win32" && (typeof process.getuid === "function" && stat.uid !== process.getuid() || (stat.mode & 18) !== 0))
    throw new ArchiveError("unsafe-path", "Plugin storage must be owned by this user and not writable by others.");
}
async function syncDirectory(path) {
  if (process.platform === "win32") {
    await assertPlainDirectory(path);
    return;
  }
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function readBoundedJson(path, limit2 = 8 * 1024 * 1024) {
  const before = await lstat(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(limit2))
    throw new ArchiveError("corrupt-state", "Recovery metadata is invalid.");
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const held = await handle.stat({ bigint: true });
    const current = await lstat(path, { bigint: true });
    if (!held.isFile() || current.isSymbolicLink() || !current.isFile() || held.size > BigInt(limit2) || before.dev !== held.dev || before.ino !== held.ino || current.dev !== held.dev || current.ino !== held.ino)
      throw new ArchiveError("unsafe-path", "Recovery metadata identity changed.");
    const encoded = await handle.readFile("utf8");
    if (Buffer.byteLength(encoded) > limit2) throw new ArchiveError("corrupt-state", "Recovery metadata is too large.");
    try {
      return JSON.parse(encoded);
    } catch {
      throw new ArchiveError("corrupt-state", "Recovery metadata could not be read.");
    }
  } finally {
    await handle.close();
  }
}

// src/dsh-adapter.ts
var importHost = (specifier) => import(specifier);
var LOG_FILE = /^session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/;
var OWNED_FILE = /^(?:session(?:\.v\d+)?\.jsonl(?:\.zstd)?|session\.migration\.[A-Za-z0-9._-]+\.tmp|session(?:\.v\d+)?\.jsonl(?:\.zstd)?\.[a-fA-F0-9]+\.tmp|session\.lock)$/;
function service(ctx, name2) {
  const found = ctx.get?.(name2);
  return found === void 0 ? ctx[name2] : found;
}
function code(error2) {
  return typeof error2 === "object" && error2 !== null && "code" in error2 && typeof error2.code === "string" ? error2.code : void 0;
}
function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function sessionKey(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 512 && !value.includes("\0");
}
function headerId(value) {
  return object(value) && sessionKey(value.id) && typeof value.version === "number" && Number.isFinite(value.version) && typeof value.createdAt === "number" && Number.isFinite(value.createdAt) && (value.parentSession === void 0 || sessionKey(value.parentSession)) && (value.origin !== "subagent" || typeof value.parentSession === "string");
}
function encodeId(value) {
  if (value === ".") return "~002E";
  if (value === "..") return "~002E~002E";
  return value.replace(/[^A-Za-z0-9._-]/g, (character) => `~${character.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`);
}
function cloneHeader(header) {
  return JSON.parse(JSON.stringify(header));
}
function sameSessionHeader(live, persisted) {
  return isDeepStrictEqual(
    { ...live, delegationDepth: live.delegationDepth === void 0 ? 0 : live.delegationDepth },
    { ...persisted, delegationDepth: persisted.delegationDepth === void 0 ? 0 : persisted.delegationDepth }
  );
}
function getNativeLockExclusive(ctx) {
  let implementation;
  return async (fd) => {
    implementation ??= (async () => {
      const profile = service(ctx, "profileContext");
      if (typeof profile?.installAnchor !== "string" || !isAbsolute2(profile.installAnchor)) throw new ArchiveError("unsupported-host", "The live DSH installation could not be resolved.");
      const filename = createRequire(profile.installAnchor).resolve("@deepseek-ai/node-addon-system/flock");
      const module = await importHost(pathToFileURL(filename).href);
      if (typeof module.tryLockExclusive !== "function") throw new ArchiveError("unsupported-host", "The native DSH write-lock capability is unavailable.");
      return module.tryLockExclusive;
    })();
    const pending = implementation;
    let lock;
    try {
      lock = await pending;
    } catch (error2) {
      if (implementation === pending) implementation = void 0;
      throw error2;
    }
    await lock(fd);
  };
}
function windowsSessionLockName(filename) {
  return `Local\\dsh-session-lock-${createHash("sha256").update(win322.resolve(filename).toLowerCase()).digest("hex")}`;
}
function isLocalWindowsDriveType(kind) {
  return kind === 2 || kind === 3 || kind === 6;
}
function getNativeWindowsLock(ctx) {
  let implementation;
  return async (filename) => {
    assertLocalStoragePath(filename);
    implementation ??= (async () => {
      const profile = service(ctx, "profileContext");
      if (typeof profile?.installAnchor !== "string" || !isAbsolute2(profile.installAnchor)) throw new ArchiveError("unsupported-host", "The live DSH installation could not be resolved.");
      const backendFile = createRequire(profile.installAnchor).resolve("@deepseek-ai/dsh-session-persistence-jsonl");
      const koffiFile = createRequire(backendFile).resolve("koffi");
      const module = await importHost(pathToFileURL(koffiFile).href);
      const koffi = module.default;
      const kernel = koffi.load("kernel32.dll");
      return {
        createSemaphore: kernel.func("__stdcall", "CreateSemaphoreW", "intptr", ["void*", "int", "int", "str16"]),
        wait: kernel.func("__stdcall", "WaitForSingleObject", "uint", ["intptr", "uint"]),
        release: kernel.func("__stdcall", "ReleaseSemaphore", "int", ["intptr", "int", "void*"]),
        close: kernel.func("__stdcall", "CloseHandle", "int", ["intptr"]),
        lastError: kernel.func("__stdcall", "GetLastError", "uint", []),
        driveType: kernel.func("__stdcall", "GetDriveTypeW", "uint", ["str16"])
      };
    })();
    const pending = implementation;
    let api;
    try {
      api = await pending;
    } catch (error2) {
      if (implementation === pending) implementation = void 0;
      throw error2;
    }
    if (!isLocalWindowsDriveType(api.driveType(win322.parse(filename).root))) throw new ArchiveError("unsafe-path", "Windows archive operations require a verified local writable drive.");
    const handle = api.createSemaphore(null, 1, 1, windowsSessionLockName(filename));
    if (handle === 0 || handle === 0n) throw Object.assign(new Error("The Windows kernel lock could not be created."), { code: "EIO", win32Code: api.lastError() });
    const acquired = api.wait(handle, 0);
    if (acquired !== 0) {
      const error2 = acquired === 258 ? { code: "EBUSY" } : { code: "EIO", win32Code: api.lastError() };
      api.close(handle);
      throw Object.assign(new Error("The Windows kernel lock is unavailable."), error2);
    }
    let released = false;
    return { release: async () => {
      if (released) return;
      released = true;
      const restored = api.release(handle, 1, null);
      const closed = api.close(handle);
      if (!restored || !closed) throw Object.assign(new Error("The Windows kernel lock could not be released."), { code: "EIO", win32Code: api.lastError() });
    } };
  };
}
async function nativeLockExclusive(fd) {
  const module = await importHost("@deepseek-ai/node-addon-system/flock");
  await module.tryLockExclusive(fd);
}
async function acquirePluginLease(root, lockExclusive = nativeLockExclusive, options = {}) {
  assertLocalStoragePath(root);
  await mkdir(root, { recursive: true, mode: 448 });
  const entry = await lstat2(root);
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new ArchiveError("unsafe-path", "The plugin data root is not a plain directory.");
  await assertCanonicalStoragePath(root);
  const filename = join(root, ".lock");
  if ((options.platform ?? process.platform) === "win32") {
    if (!options.lockNamed) throw new ArchiveError("unsupported-host", "The native Windows write-lock capability is unavailable.");
    try {
      return await options.lockNamed(filename);
    } catch (error2) {
      if (code(error2) === "EBUSY") throw new ArchiveError("store-busy", "Another DSH process owns this archive-delete store. Close that instance before enabling mutations here.");
      throw error2;
    }
  }
  const handle = await open2(filename, constants2.O_CREAT | constants2.O_RDWR | constants2.O_NOFOLLOW, 384);
  try {
    await lockExclusive(handle.fd);
    const held = await handle.stat({ bigint: true });
    const current = await lstat2(filename, { bigint: true });
    if (!current.isFile() || current.isSymbolicLink() || held.dev !== current.dev || held.ino !== current.ino) throw new ArchiveError("unsafe-lock", "The plugin-store lock identity changed.");
    let released = false;
    return { release: async () => {
      if (!released) {
        released = true;
        await handle.close();
      }
    } };
  } catch (error2) {
    await handle.close();
    if (code(error2) === "EAGAIN" || code(error2) === "EWOULDBLOCK") throw new ArchiveError("store-busy", "Another DSH process owns this archive-delete store. Close that instance before enabling mutations here.");
    throw error2;
  }
}
function titleOf(cache, header) {
  const title = (cache?.cachedSnapshot(header, ["title"]) ?? cache?.cachedPredecessorTitle?.(header))?.values.title;
  if (typeof title === "string" && title.trim()) return title;
  if (object(title) && typeof title.title === "string" && title.title.trim()) return title.title;
  return header.id;
}
function normalizeActivity(value) {
  if (!object(value) || typeof value.kind !== "string") return { kind: "unknown", label: "Unrecognized activity provider response" };
  const labels = [];
  for (const key of ["label", "title", "name"]) if (typeof value[key] === "string") labels.push(value[key]);
  if (Array.isArray(value.items)) {
    for (const item of value.items) if (object(item) && typeof item.label === "string") labels.push(item.label);
  }
  return { kind: value.kind, label: labels.join(", ") || value.kind };
}
async function getHostPaths(ctx, homeOverride) {
  let home;
  if (homeOverride !== void 0) home = resolve2(homeOverride);
  else if (typeof service(ctx, "dshHomePath") === "function") home = resolve2(service(ctx, "dshHomePath")());
  else {
    const homeModule = await importHost("@deepseek-ai/dsh-home-paths");
    home = resolve2(homeModule.resolveDshHome());
  }
  const persistence = service(ctx, "sessionPersistence");
  const sessionsRoot = persistence && typeof persistence.root === "string" && isAbsolute2(persistence.root) ? resolve2(persistence.root) : join(home, "sessions");
  const root = join(home, "archive-delete");
  for (const path of [home, sessionsRoot, root]) assertLocalStoragePath(path);
  return { home, sessionsRoot, root };
}
function storageService(ctx, name2) {
  try {
    return service(ctx, name2);
  } catch {
    return void 0;
  }
}
function storagePath(value) {
  if (typeof value !== "string" || value.includes("\0") || !isAbsolute2(value)) return void 0;
  try {
    assertLocalStoragePath(value);
    return resolve2(value);
  } catch {
    return void 0;
  }
}
function registeredStorageWorkspace(ctx, id2) {
  const registry = storageService(ctx, "workspaceRegistry");
  if (!object(registry) || typeof registry.requireState !== "function" || !(registry.entities instanceof Map)) return void 0;
  try {
    const state = registry.requireState();
    if (!object(state) || !Array.isArray(state.workspaceIds) || !state.workspaceIds.includes(id2)) return void 0;
    const entity = registry.entities.get(id2);
    if (!object(entity) || !object(entity.record)) return void 0;
    const record3 = entity.record;
    const title = typeof record3.title === "string" && record3.title.trim() ? record3.title : typeof record3.path === "string" ? basename(record3.path) || "Workspace" : "Workspace";
    return { id: id2, title, path: record3.path };
  } catch {
    return void 0;
  }
}
function getStorageWorkspaces(ctx) {
  const registry = storageService(ctx, "workspaceRegistry");
  if (!object(registry) || typeof registry.requireState !== "function") return [];
  try {
    const state = registry.requireState();
    if (!object(state) || !Array.isArray(state.workspaceIds)) return [];
    return [...new Set(state.workspaceIds)].flatMap((id2) => {
      if (typeof id2 !== "string" || !id2 || id2.length > 512 || id2.includes("\0")) return [];
      const entry = registeredStorageWorkspace(ctx, id2);
      return entry ? [{ id: id2, title: entry.title }] : [];
    });
  } catch {
    return [];
  }
}
async function getStorageSources(ctx, workspaceId) {
  const profile = storageService(ctx, "profileContext");
  let version = "unknown";
  if (object(profile) && typeof profile.installAnchor === "string" && isAbsolute2(profile.installAnchor)) {
    try {
      const manifest = JSON.parse(await readFile(profile.installAnchor, "utf8"));
      if (object(manifest) && manifest.name === "@deepseek-ai/dsh" && typeof manifest.version === "string") version = manifest.version;
    } catch {
    }
  }
  if (!isSupportedDshVersion(version)) throw new ArchiveError("unsupported-host", `Storage inspection requires DSH ${SUPPORTED_DSH_VERSION_LABEL}; the current runtime is ${version}.`);
  let home;
  const homeResolver = storageService(ctx, "dshHomePath");
  if (typeof homeResolver === "function") {
    try {
      home = storagePath(homeResolver());
    } catch {
    }
  }
  const persistence = storageService(ctx, "sessionPersistence");
  const attachments = storageService(ctx, "attachments");
  const spill = storageService(ctx, "spillStore");
  const query = storageService(ctx, "sessionQuery");
  const storage = storageService(ctx, "storage");
  let settings;
  try {
    if (object(storage) && object(storage.backend) && typeof storage.backend.get === "function") settings = storage.backend.get("json");
  } catch {
  }
  const property = (owner, key) => object(owner) ? storagePath(owner[key]) : void 0;
  const pluginRoot = home ? join(home, "archive-delete") : void 0;
  const queryPath = object(query) && object(query.config) ? query.config.path : void 0;
  const root = (id2, path, unavailableReason = "root-unresolved") => ({ id: id2, kind: id2, readOnly: true, ...path ? { path } : { unavailableReason } });
  const roots = [
    root("sessions", property(persistence, "root")),
    ...["trash", "staging", "operations", "receipts"].map((id2) => root(id2, pluginRoot ? join(pluginRoot, id2) : void 0)),
    root("attachments", property(attachments, "root")),
    root("attachment-cache", property(attachments, "cacheRoot")),
    root("cache", home ? join(home, "cache") : void 0),
    root("settings", property(settings, "root")),
    root("profiles", home ? join(home, "profiles") : void 0),
    root("spill", property(spill, "root")),
    { ...root("search", storagePath(queryPath), queryPath === ":memory:" ? "in-memory" : "root-unresolved"), file: true },
    root("other", home)
  ];
  for (const item of roots) if (item.path && !item.file) {
    const descendants = roots.flatMap((candidate2) => candidate2.path && isWithin(item.path, candidate2.path) ? [candidate2.path] : []);
    const excludes = [...new Set(descendants)].filter((path) => !descendants.some((parent) => parent !== path && isWithin(parent, path)));
    if (excludes.length) item.excludePaths = excludes;
  }
  const protectedPaths = [pluginRoot, ...roots.filter((item) => item.id !== "other").map((item) => item.path)].filter((path) => path !== void 0);
  const isInternal = (path, boundary) => samePath(path, boundary) || isWithin(boundary, path);
  const userHome = resolve2(homedir());
  const protectedWorkspace = (path) => samePath(path, parse(path).root) || samePath(path, userHome) || isWithin(path, userHome) || home !== void 0 && samePath(path, home) || protectedPaths.some((boundary) => isInternal(path, boundary));
  if (workspaceId === void 0) {
    const projects = getStorageWorkspaces(ctx).flatMap((workspace) => {
      const path = storagePath(registeredStorageWorkspace(ctx, workspace.id)?.path);
      return path && !protectedWorkspace(path) ? [path] : [];
    });
    for (const item of roots) if (item.path && !item.file) {
      const paths = [...item.excludePaths ?? [], ...projects.filter((path) => isWithin(item.path, path))];
      const minimal = [...new Set(paths)].filter((path) => !paths.some((parent) => parent !== path && isWithin(parent, path)));
      if (minimal.length) item.excludePaths = minimal;
    }
    return roots;
  }
  if (!workspaceId || workspaceId.length > 512 || workspaceId.includes("\0")) throw new ArchiveError("invalid-request", "A registered workspace ID is required.");
  const selected = registeredStorageWorkspace(ctx, workspaceId);
  if (!selected) throw new ArchiveError("workspace-not-found", "The selected workspace is no longer registered.");
  const selectedPath = storagePath(selected.path);
  if (!selectedPath) throw new ArchiveError("unsafe-workspace", "The selected workspace does not have a safe absolute path.");
  if (protectedWorkspace(selectedPath))
    throw new ArchiveError("unsafe-workspace", "Select a project directory outside protected host storage.");
  const exclusions = [...protectedPaths, ...home ? [home] : []].filter((path) => isWithin(selectedPath, path));
  try {
    const entry = await lstat2(selectedPath);
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new ArchiveError("unsafe-workspace", "The selected workspace must be a plain project directory.");
    const canonical = await realpath2(selectedPath);
    await assertCanonicalStoragePath(selectedPath, canonical);
    if (!samePath(selectedPath, canonical)) throw new ArchiveError("unsafe-workspace", "The selected workspace path redirects through a symbolic link.");
    for (const path of protectedPaths) {
      let boundary = path;
      try {
        boundary = await realpath2(path);
      } catch {
      }
      if (isInternal(canonical, boundary)) throw new ArchiveError("unsafe-workspace", "The selected workspace is inside protected host storage.");
      if (isWithin(canonical, boundary)) exclusions.push(boundary);
    }
  } catch (error2) {
    if (code(error2) !== "ENOENT") throw error2;
  }
  const current = registeredStorageWorkspace(ctx, workspaceId);
  if (!current || current.path !== selected.path) throw new ArchiveError("workspace-changed", "The selected workspace changed. Select it again and rescan.");
  const excludePaths = [...new Set(exclusions)].filter((path) => !exclusions.some((parent) => parent !== path && isWithin(parent, path)));
  return [{
    id: "workspace",
    kind: "workspace",
    label: selected.title,
    path: selectedPath,
    readOnly: true,
    ...excludePaths.length ? { excludePaths } : {}
  }];
}
async function createDshAdapter(ctx, options = {}) {
  let version = options.version;
  if (version === void 0) {
    const profile = service(ctx, "profileContext");
    version = "unknown";
    if (typeof profile?.installAnchor === "string" && isAbsolute2(profile.installAnchor)) {
      const manifest = JSON.parse(await readFile(profile.installAnchor, "utf8"));
      if (object(manifest) && manifest.name === "@deepseek-ai/dsh" && typeof manifest.version === "string") version = manifest.version;
    }
  }
  const paths = await getHostPaths(ctx, options.home);
  const lockExclusive = options.lockExclusive ?? getNativeLockExclusive(ctx);
  return new NativeAdapter(ctx, paths, version, options.platform ?? process.platform, lockExclusive, options.lockNamed ?? getNativeWindowsLock(ctx), options.effectSymbol);
}
var NativeAdapter = class {
  constructor(ctx, paths, version, platform, lockExclusive, lockNamed, effectSymbol) {
    this.ctx = ctx;
    this.paths = paths;
    this.version = version;
    this.platform = platform;
    this.lockExclusive = lockExclusive;
    this.lockNamed = lockNamed;
    this.effectSymbol = effectSymbol;
    this.persistence = service(ctx, "sessionPersistence");
    this.registry = service(ctx, "workspaceRegistry");
    this.sessions = service(ctx, "sessions");
    this.cache = service(ctx, "sessionProjectionCache");
  }
  issues = [];
  releaseWarnings = /* @__PURE__ */ new Set();
  persistence;
  registry;
  sessions;
  cache;
  async capabilities() {
    let reason;
    if (this.platform !== "darwin" && this.platform !== "win32") reason = "Only macOS and Windows Desktop are supported in this release.";
    else if (!isSupportedDshVersion(this.version)) reason = `DSH Desktop ${SUPPORTED_DSH_VERSION_LABEL} is required; the current runtime is ${this.version}. Update DSH Desktop to a supported version, then restart this plugin.`;
    else if (this.persistence?.name !== "session-persistence-jsonl" || !isAbsolute2(this.persistence.root)) reason = "The official JSONL session backend is required.";
    else if (!this.sessions || typeof this.sessions.get !== "function" || !this.ctx.waterfall || !this.ctx.emit) reason = "Session activity and lifecycle services are unavailable.";
    else if (!this.registry || !["requireState", "requireTable", "enqueueOperation", "setState", "indexHeader"].every((key) => typeof this.registry[key] === "function") || !(this.registry.headers instanceof Map) || !(this.registry.sessionPaths instanceof Map) || !(this.registry.missingSessionPaths instanceof Set) || !(this.registry.invalidSessionPaths instanceof Map)) reason = "The DSH workspace adapter is incompatible.";
    else if (!this.cache || typeof this.cache.requireTable !== "function" || typeof this.cache.cachedSnapshot !== "function" || typeof this.cache.put !== "function" || !service(this.ctx, "sessionProjections")?.restore || typeof this.persistence.open !== "function") reason = "The official projection-cache service is unavailable.";
    return { supported: reason === void 0, version: this.version, platform: this.platform, ...reason ? { reason } : {} };
  }
  async requireSupported() {
    const support = await this.capabilities();
    if (!support.supported) throw new ArchiveError("unsupported-host", support.reason ?? "Unsupported host");
  }
  listIssues() {
    return this.issues;
  }
  releaseUnavailable(reason) {
    if (!this.releaseWarnings.has(reason)) {
      this.releaseWarnings.add(reason);
      try {
        this.ctx.logger?.warn(`[archive-delete] Idle release is unavailable (${reason}); no session logs were moved. The confirmed request can remain pending.`);
      } catch {
      }
    }
    return false;
  }
  async lifecycleSymbols() {
    if (this.effectSymbol) return { effect: this.effectSymbol };
    const profile = service(this.ctx, "profileContext");
    if (typeof profile?.installAnchor !== "string" || !isAbsolute2(profile.installAnchor)) return void 0;
    try {
      const filename = createRequire(profile.installAnchor).resolve("@deepseek-ai/cordis");
      const module = await importHost(pathToFileURL(filename).href);
      const symbols = module.symbols;
      if (!object(symbols) || typeof symbols.effect !== "symbol") return void 0;
      return { effect: symbols.effect, ...typeof symbols.original === "symbol" ? { original: symbols.original } : {} };
    } catch {
      return void 0;
    }
  }
  /** Invoke the supported host's exact owner teardown after identity and activity checks. */
  async releaseIdle(group) {
    await this.requireSupported();
    if (group.members.every((member) => this.sessions.get(member.id) === void 0)) return true;
    const symbols = await this.lifecycleSymbols();
    const agents = service(this.ctx, "agents");
    const loop = service(this.ctx, "agentLoop");
    if (!symbols || !agents || !loop || typeof this.sessions.flush !== "function" || !["get", "list", "isOwnedBy", "requireFactory"].every((key) => typeof agents[key] === "function")) return this.releaseUnavailable("missing-lifecycle-capability");
    let factory;
    try {
      factory = agents.requireFactory().target;
    } catch {
      return this.releaseUnavailable("factory-unavailable");
    }
    const originalLoop = symbols.original ? loop[symbols.original] ?? loop : loop;
    if (originalLoop !== factory || !object(factory) || !object(factory.runtime) || !object(factory.runtime.ctx)) return this.releaseUnavailable("factory-identity");
    const loopContext = factory.runtime.ctx;
    const registry = loopContext.registry;
    if (!object(registry) || typeof registry.values !== "function") return this.releaseUnavailable("lifecycle-registry");
    const fibers = /* @__PURE__ */ new Set();
    const ancestors = (candidate2) => {
      while (object(candidate2) && !fibers.has(candidate2)) {
        fibers.add(candidate2);
        candidate2 = object(candidate2.parent) ? candidate2.parent.fiber : void 0;
      }
    };
    ancestors(this.ctx.fiber);
    ancestors(loopContext.fiber);
    try {
      for (const runtime of registry.values.call(registry)) {
        if (!object(runtime) || !object(runtime.fibers) || typeof runtime.fibers[Symbol.iterator] !== "function") return this.releaseUnavailable("runtime-fibers");
        for (const fiber of runtime.fibers) ancestors(fiber);
      }
    } catch {
      return this.releaseUnavailable("runtime-enumeration");
    }
    const rootArchived = () => {
      if (!this.registry.archivedSessionIds.includes(group.sessionId)) throw new ArchiveError("not-archived", "Only archived sessions can be released for trash.");
    };
    const inspectPlan = () => {
      rootArchived();
      const plans = [];
      const ids2 = new Set(group.members.map((member) => member.id));
      const live = agents.list();
      if (!Array.isArray(live) || live.some((agent) => !object(agent) || typeof agent.id !== "string")) return void 0;
      for (const member of group.members) {
        const session = this.sessions.get(member.id);
        const agent = agents.get(member.id);
        if (session === void 0) {
          if (agent !== void 0) throw new ArchiveError("ambiguous-lifecycle", "The host agent and session lifecycles disagree.");
          continue;
        }
        if (!agent || !object(agent.phase) || !object(agent.inbox)) return void 0;
        if (agent.session !== session || agent.id !== member.id || !sameSessionHeader(agent.session.header, member.header))
          throw new ArchiveError("source-changed", "The loaded session identity changed. Review a new preview.");
        if (agent.status !== "idle" || agent.phase.kind !== "idle" || agent.inbox.hasPending !== false)
          throw new ArchiveError("active", "A session has active maintenance or queued input. Nothing was released.");
        if (live.some((child) => !ids2.has(child.id) && agents.isOwnedBy(child.id, agent)))
          throw new ArchiveError("ambiguous-lineage", "The host owns a child outside the confirmed session group.");
        const matches = /* @__PURE__ */ new Set();
        for (const fiber of fibers) {
          const disposables = fiber._disposables;
          if (!object(disposables) || typeof disposables[Symbol.iterator] !== "function") return void 0;
          for (const dispose of disposables) {
            if (typeof dispose !== "function") continue;
            const metadata2 = dispose[symbols.effect];
            if (object(metadata2) && metadata2.label === `agentLoop.lifecycle(${member.id})`) matches.add(dispose);
          }
        }
        if (!matches.size) return void 0;
        if (matches.size !== 1) throw new ArchiveError("ambiguous-lifecycle", "Multiple host owners claim this session lifecycle. Nothing was released.");
        plans.push({ id: member.id, session, agent, dispose: [...matches][0] });
      }
      const ordered = [];
      while (plans.length) {
        const leaf = plans.findIndex((parent) => !plans.some((child) => child !== parent && agents.isOwnedBy(child.id, parent.agent)));
        if (leaf < 0) throw new ArchiveError("ambiguous-lineage", "The host runtime ownership graph is cyclic.");
        ordered.push(plans.splice(leaf, 1)[0]);
      }
      return ordered;
    };
    const checkActivity = async () => {
      rootArchived();
      for (const member of group.members) {
        if ((await this.ctx.waterfall("workspace/session-activity", { sessionId: member.id }, async () => [])).length)
          throw new ArchiveError("active", "A session or related task is active. Nothing was released.");
      }
    };
    await checkActivity();
    const prepared = inspectPlan();
    if (prepared === void 0) return this.releaseUnavailable("unverified-session-owner");
    for (const plan of prepared) await this.sessions.flush(plan.session);
    await checkActivity();
    const current = inspectPlan();
    if (!current || current.length !== prepared.length || current.some((plan, index) => plan.agent !== prepared[index].agent || plan.session !== prepared[index].session || plan.dispose !== prepared[index].dispose))
      throw new ArchiveError("source-changed", "A session lifecycle changed while release was being prepared.");
    const settlements = await Promise.allSettled(current.map((plan) => {
      try {
        return Promise.resolve(plan.dispose());
      } catch (error2) {
        return Promise.reject(error2);
      }
    }));
    if (settlements.some((settlement) => settlement.status === "rejected") || group.members.some((member) => this.sessions.get(member.id) !== void 0 || agents.get(member.id) !== void 0))
      throw new ArchiveError("release-failed", "The host could not finish releasing this idle session. Its logs have not been moved.");
    return true;
  }
  async catalog() {
    const candidates = await this.persistence.list();
    if (!Array.isArray(candidates)) throw new ArchiveError("invalid-session", "The host returned an invalid session inventory.");
    const ids2 = /* @__PURE__ */ new Map();
    const related = /* @__PURE__ */ new Map();
    for (const value of candidates) {
      const header = object(value) && object(value.header) ? value.header : void 0;
      if (typeof header?.id !== "string" || !header.id) continue;
      ids2.set(header.id, (ids2.get(header.id) ?? 0) + 1);
      if (!related.has(header.id)) related.set(header.id, /* @__PURE__ */ new Set());
      if (typeof header.parentSession === "string" && header.parentSession) {
        if (!related.has(header.parentSession)) related.set(header.parentSession, /* @__PURE__ */ new Set());
        related.get(header.id).add(header.parentSession);
        related.get(header.parentSession).add(header.id);
      }
    }
    const snapshots = [];
    const issues = [];
    const protectedIds = /* @__PURE__ */ new Set();
    let unidentified = false;
    for (const value of candidates) {
      const header = object(value) && object(value.header) ? value.header : void 0;
      const id2 = typeof header?.id === "string" && header.id ? header.id : void 0;
      if (headerId(header) && ids2.get(header.id) === 1) {
        snapshots.push(value);
        continue;
      }
      if (id2) protectedIds.add(id2);
      else if (typeof header?.parentSession === "string" && header.parentSession) protectedIds.add(header.parentSession);
      else unidentified = true;
      if (id2 && !sessionKey(id2) && !sessionKey(header?.parentSession)) unidentified = true;
      if (header && (header.parentSession !== void 0 && !sessionKey(header.parentSession) || header.origin === "subagent" && typeof header.parentSession !== "string")) unidentified = true;
      issues.push({
        scope: "archive",
        ...sessionKey(id2) ? { id: id2 } : {},
        code: "invalid-session",
        message: "A damaged or duplicated session was excluded. Related conversations remain protected until the host inventory is repaired."
      });
    }
    const pending = [...protectedIds];
    for (let index = 0; index < pending.length; index++) for (const id2 of related.get(pending[index]) ?? []) {
      if (!protectedIds.has(id2)) {
        protectedIds.add(id2);
        pending.push(id2);
      }
    }
    return { snapshots, issues, protectedIds, unidentified };
  }
  async listArchived() {
    await this.requireSupported();
    const catalog = await this.catalog();
    const { snapshots } = catalog;
    this.issues = catalog.issues;
    const archived = new Set(this.registry.archivedSessionIds);
    const records = this.registry.requireState().workspaceIds.map((id2) => this.registry.requireTable().get(id2)).filter((record3) => record3 !== void 0);
    const accounts = /* @__PURE__ */ new Map();
    for (const record3 of records) for (const id2 of record3.sessionIds) if (!accounts.has(id2)) accounts.set(id2, record3);
    const childrenByParent = this.descendantIndex(snapshots);
    return snapshots.filter(({ header }) => archived.has(header.id) && header.origin !== "subagent").map(({ header, sizeBytes }) => {
      const children = this.descendants(header.id, childrenByParent, false);
      const workspace = accounts.get(header.id);
      return {
        id: header.id,
        title: titleOf(this.cache, header),
        workspace: workspace?.title ?? workspace?.path ?? "",
        sizeBytes: (sizeBytes ?? 0) + children.reduce((sum, child) => sum + (child.sizeBytes ?? 0), 0),
        descendantCount: children.length
      };
    });
  }
  /** Only explicit subagent ancestry is owned; a fork's parent pointer is not ownership. */
  descendantIndex(snapshots) {
    const index = /* @__PURE__ */ new Map();
    for (const snapshot of snapshots) if (snapshot.header.origin === "subagent" && typeof snapshot.header.parentSession === "string") {
      const children = index.get(snapshot.header.parentSession) ?? [];
      children.push(snapshot);
      index.set(snapshot.header.parentSession, children);
    }
    return index;
  }
  descendants(id2, index, strict = true) {
    const visited = /* @__PURE__ */ new Set([id2]);
    const result2 = [];
    const pending = [...index.get(id2) ?? []].reverse();
    while (pending.length) {
      const snapshot = pending.pop();
      if (visited.has(snapshot.header.id)) {
        if (strict) throw new ArchiveError("ambiguous-lineage", "Cyclic subagent ownership prevents safe cleanup.");
        continue;
      }
      visited.add(snapshot.header.id);
      result2.push(snapshot);
      pending.push(...[...index.get(snapshot.header.id) ?? []].reverse());
    }
    return result2;
  }
  async inspect(sessionId) {
    await this.requireSupported();
    const { snapshots, protectedIds, unidentified } = await this.catalog();
    if (unidentified || protectedIds.has(sessionId)) throw new ArchiveError("invalid-session", "Damaged session identity or ancestry prevents safe cleanup of this group. Repair the host inventory before continuing.");
    const root = snapshots.find(({ header }) => header.id === sessionId);
    if (!root) throw new ArchiveError("session-missing", "The session no longer exists.");
    if (root.header.origin === "subagent") throw new ArchiveError("subagent-target", "Move the parent conversation instead of an individual subagent.");
    const selected = [root, ...this.descendants(sessionId, this.descendantIndex(snapshots))];
    const byId = new Map(snapshots.map((snapshot) => [snapshot.header.id, snapshot.header]));
    for (const snapshot of selected) {
      const ancestry = /* @__PURE__ */ new Set();
      let header = snapshot.header;
      while (header) {
        if (ancestry.has(header.id)) throw new ArchiveError("ambiguous-lineage", "Cyclic session ancestry prevents safe cleanup.");
        ancestry.add(header.id);
        header = typeof header.parentSession === "string" ? byId.get(header.parentSession) : void 0;
      }
    }
    const ids2 = new Set(selected.map(({ header }) => header.id));
    for (const snapshot of snapshots) {
      if (!ids2.has(snapshot.header.id) && typeof snapshot.header.parentSession === "string" && ids2.has(snapshot.header.parentSession)) {
        if (snapshot.header.origin !== void 0 || snapshot.header.isSeeded !== true || snapshot.formatStatus !== "current") {
          throw new ArchiveError("dependent-session", "A legacy or ambiguous descendant may still depend on this conversation. Restore or migrate it before cleanup.");
        }
      }
    }
    const members = [];
    for (const snapshot of selected) members.push(await this.member(snapshot));
    return { sessionId, title: members[0].title, sessionsRoot: this.paths.sessionsRoot, members };
  }
  async member(snapshot) {
    const { header } = snapshot;
    const location = this.persistence.locate(header);
    if (location?.kind !== "jsonl" || !isAbsolute2(location.path) || !LOG_FILE.test(basename(location.path))) throw new ArchiveError("unsupported-layout", "The session artifact cannot be located safely.");
    const directory = dirname(location.path);
    await this.validateDirectory(directory, header.id);
    const filenames = (await readdir(directory)).sort();
    const fingerprint = [];
    let sizeBytes = 0;
    for (const filename of filenames) {
      const file = await lstat2(join(directory, filename), { bigint: true });
      if (!file.isFile() || file.isSymbolicLink() || !OWNED_FILE.test(filename)) throw new ArchiveError("unknown-artifact", "Unexpected files prevent safe cleanup.");
      if (filename === "session.lock") continue;
      sizeBytes += Number(file.size);
      fingerprint.push(`${filename}:${file.dev}:${file.ino}:${file.size}:${file.mtimeNs}`);
    }
    if (!filenames.some((filename) => LOG_FILE.test(filename))) throw new ArchiveError("session-missing", "No session log remains.");
    const revision = createHash("sha256").update(JSON.stringify(header)).update("\0").update(fingerprint.join("\n")).digest("hex");
    const state = this.registry.requireState();
    const accounts = state.workspaceIds.map((id2) => ({ id: id2, record: this.registry.requireTable().get(id2) })).filter(({ record: record3 }) => record3?.sessionIds.includes(header.id));
    if (accounts.length > 1) throw new ArchiveError("ambiguous-workspace", "A session is registered in multiple workspaces.");
    const account = accounts[0];
    const activity = (await this.ctx.waterfall("workspace/session-activity", { sessionId: header.id }, async () => [])).map(normalizeActivity);
    return {
      id: header.id,
      title: titleOf(this.cache, header),
      directory,
      revision,
      header: cloneHeader(header),
      ...account?.record ? { workspaceId: account.id, workspacePath: account.record.path, accountIndex: account.record.sessionIds.indexOf(header.id) } : {},
      archived: state.archivedSessionIds.includes(header.id),
      pinned: state.pinnedSessionIds.includes(header.id),
      loaded: this.sessions.get(header.id) !== void 0,
      activity,
      sizeBytes
    };
  }
  async validateDirectory(directory, sessionId) {
    const root = resolve2(this.paths.sessionsRoot);
    assertLocalStoragePath(directory);
    const rel = relative2(root, resolve2(directory));
    const segments = rel.split(sep2);
    if (!rel || rel.startsWith(`..${sep2}`) || rel === ".." || isAbsolute2(rel) || segments.length !== 2 || basename(directory) !== encodeId(sessionId)) throw new ArchiveError("unsafe-path", "Session storage ownership could not be verified.");
    const project = dirname(directory);
    for (const path of [root, project, directory]) {
      const entry = await lstat2(path);
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new ArchiveError("unsafe-path", "Symbolic links or non-directory session paths are not supported.");
    }
    const canonicalRoot = await realpath2(root);
    const canonicalDirectory = await realpath2(directory);
    assertLocalStoragePath(canonicalRoot);
    assertLocalStoragePath(canonicalDirectory);
    await assertCanonicalStoragePath(root, canonicalRoot);
    await assertCanonicalStoragePath(directory, canonicalDirectory);
    if (!samePath(canonicalDirectory, join(canonicalRoot, rel))) throw new ArchiveError("unsafe-path", "Session path changed during inspection.");
  }
  async acquire(group) {
    await this.requireSupported();
    for (const member of group.members) await this.validateDirectory(member.directory, member.id);
    return this.acquireLocated(group, group.members.map((member) => member.directory));
  }
  /** Trusted storage supplies validated source/staging/trash locations, never browser paths. */
  async acquireLocated(group, directories) {
    await this.requireSupported();
    if (directories.length !== group.members.length || new Set(directories.filter((directory) => directory !== void 0)).size !== directories.filter((directory) => directory !== void 0).length) throw new ArchiveError("unsafe-path", "The recovery locations do not match this session group.");
    const loaded = new Set(group.members.filter(({ id: id2 }) => this.sessions.get(id2) !== void 0).map(({ id: id2 }) => id2));
    if (this.platform === "win32") return this.acquireWindowsLocated(group, directories, loaded);
    const handles = [];
    try {
      const targets = group.members.map((member, index) => ({ member, directory: directories[index] })).sort((a, b) => a.member.id.localeCompare(b.member.id));
      for (const { member, directory } of targets) {
        assertLocalStoragePath(member.directory);
        if (directory !== void 0) assertLocalStoragePath(directory);
        const activity = await this.ctx.waterfall("workspace/session-activity", { sessionId: member.id }, async () => []);
        if (activity.length) {
          await Promise.allSettled(handles.map((handle2) => handle2.close()));
          return { kind: "busy", message: "A session or related task is active." };
        }
        if (loaded.has(member.id) || directory === void 0) continue;
        const entry = await lstat2(directory);
        if (!isAbsolute2(directory) || !entry.isDirectory() || entry.isSymbolicLink()) throw new ArchiveError("unsafe-path", "A recovery location is not a plain canonical directory.");
        const filename = join(directory, "session.lock");
        const handle = await open2(filename, constants2.O_CREAT | constants2.O_RDWR | constants2.O_NOFOLLOW, 384);
        handles.push(handle);
        await this.lockExclusive(handle.fd);
        const held = await handle.stat({ bigint: true });
        const current = await lstat2(filename, { bigint: true });
        if (!current.isFile() || current.isSymbolicLink() || held.dev !== current.dev || held.ino !== current.ino) throw new ArchiveError("unsafe-lock", "The session write-lock identity changed.");
      }
      if (loaded.size) {
        await Promise.allSettled(handles.map((handle) => handle.close()));
        return { kind: "loaded", message: "An idle session is still held by this DSH process." };
      }
      let released = false;
      return { kind: "acquired", lease: { release: async () => {
        if (released) return;
        released = true;
        const settled = await Promise.allSettled(handles.map((handle) => handle.close()));
        const failure2 = settled.find((result2) => result2.status === "rejected");
        if (failure2?.status === "rejected") throw failure2.reason;
      } } };
    } catch (error2) {
      await Promise.allSettled(handles.map((handle) => handle.close()));
      if (code(error2) === "EAGAIN" || code(error2) === "EWOULDBLOCK") return { kind: "busy", message: "Another process holds the session write lock." };
      throw error2;
    }
  }
  async acquireWindowsLocated(group, directories, loaded) {
    const leases = [];
    const release2 = async () => {
      const results = await Promise.allSettled(leases.map((lease) => lease.release()));
      const failure2 = results.find((result2) => result2.status === "rejected");
      if (failure2?.status === "rejected") throw failure2.reason;
    };
    try {
      const targets = group.members.map((member, index) => ({ member, directory: directories[index] })).sort((a, b) => a.member.id.localeCompare(b.member.id));
      const heldNames = /* @__PURE__ */ new Set();
      for (const { member, directory } of targets) {
        assertLocalStoragePath(member.directory);
        if (directory !== void 0) assertLocalStoragePath(directory);
        const activity = await this.ctx.waterfall("workspace/session-activity", { sessionId: member.id }, async () => []);
        if (activity.length) {
          await release2();
          return { kind: "busy", message: "A session or related task is active." };
        }
        if (loaded.has(member.id)) continue;
        if (directory !== void 0) {
          const entry = await lstat2(directory);
          if (!isAbsolute2(directory) || !entry.isDirectory() || entry.isSymbolicLink()) throw new ArchiveError("unsafe-path", "A recovery location is not a plain directory.");
          await assertCanonicalStoragePath(directory);
        }
        for (const candidate2 of [member.directory, dirname(member.directory)]) {
          try {
            await assertCanonicalStoragePath(candidate2);
          } catch (error2) {
            if (code(error2) !== "ENOENT") throw error2;
          }
        }
        for (const path of [member.directory, directory]) {
          if (path === void 0) continue;
          const filename = join(path, "session.lock");
          const name2 = windowsSessionLockName(filename);
          if (heldNames.has(name2)) continue;
          leases.push(await this.lockNamed(filename));
          heldNames.add(name2);
        }
      }
      if (loaded.size) {
        await release2();
        return { kind: "loaded", message: "An idle session is still held by this DSH process." };
      }
      let released = false;
      return { kind: "acquired", lease: { release: async () => {
        if (!released) {
          released = true;
          await release2();
        }
      } } };
    } catch (error2) {
      await release2().catch(() => {
      });
      if (code(error2) === "EBUSY") return { kind: "busy", message: "Another process holds the session write lock." };
      throw error2;
    }
  }
  async restoreProjections(member) {
    const reader = await this.persistence.open(member.id, "read");
    try {
      if (!sameSessionHeader(reader.header, member.header)) throw new ArchiveError("restore-identity", "Restored session identity changed before projection recovery.");
      const { events } = await reader.read();
      const registry = service(this.ctx, "sessionProjections");
      const restored = registry.restore({}, events, 0, reader.header, reader.inheritedEventCount);
      const header = reader.header;
      await this.cache.put(member.id, { formatVersion: header.version, createdAt: header.createdAt, ...header.cwd === void 0 ? {} : { cwd: header.cwd }, isSeeded: header.isSeeded ?? false, inheritedEventCount: reader.inheritedEventCount }, restored.checkpoint);
    } finally {
      await reader.close();
    }
  }
  async removeRegistry(group) {
    await this.requireSupported();
    if (group.members.some(({ id: id2 }) => this.sessions.get(id2) !== void 0)) throw new ArchiveError("session-loaded", "A session became loaded before its registry could be updated.");
    const ids2 = new Set(group.members.map(({ id: id2 }) => id2));
    await this.registry.enqueueOperation(async () => {
      const table = this.registry.requireTable();
      for (const workspaceId of this.registry.requireState().workspaceIds) {
        if (!table.get(workspaceId)?.sessionIds.some((id2) => ids2.has(id2))) continue;
        const record3 = await table.update(workspaceId, (current) => ({ ...current, sessionIds: current.sessionIds.filter((id2) => !ids2.has(id2)), updatedAt: (/* @__PURE__ */ new Date()).toISOString() }));
        const entity = this.registry.entities.get(workspaceId);
        if (entity) entity.record = record3;
      }
      const state = this.registry.requireState();
      await this.registry.setState({ ...state, archivedSessionIds: state.archivedSessionIds.filter((id2) => !ids2.has(id2)), pinnedSessionIds: state.pinnedSessionIds.filter((id2) => !ids2.has(id2)) });
      for (const id2 of ids2) {
        await this.cache.requireTable().delete(id2);
        this.registry.headers.delete(id2);
        this.registry.sessionPaths.delete(id2);
        this.registry.missingSessionPaths.delete(id2);
        this.registry.invalidSessionPaths.delete(id2);
      }
    });
    for (const id2 of ids2) this.ctx.emit("api-session/removed", id2);
  }
  async restoreRegistry(group) {
    await this.requireSupported();
    const restored = [];
    for (const member of group.members) {
      const snapshot = await this.persistence.stat(member.id);
      if (!snapshot || !sameSessionHeader(snapshot.header, member.header)) throw new ArchiveError("restore-identity", "Restored session identity does not match the recorded session.");
      await this.restoreProjections(member);
      restored.push({ member, snapshot });
    }
    await this.registry.enqueueOperation(async () => {
      const table = this.registry.requireTable();
      for (const { member, snapshot } of restored) {
        await this.registry.indexHeader(snapshot.header);
        const account = member.workspaceId ? table.get(member.workspaceId) : void 0;
        if (member.workspaceId && account && account.path === member.workspacePath) {
          const record3 = await table.update(member.workspaceId, (current) => {
            if (current.sessionIds.includes(member.id)) return current;
            const sessionIds = [...current.sessionIds];
            sessionIds.splice(Math.min(Math.max(member.accountIndex ?? sessionIds.length, 0), sessionIds.length), 0, member.id);
            return { ...current, sessionIds, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
          });
          const entity = this.registry.entities.get(member.workspaceId);
          if (entity) entity.record = record3;
        }
      }
      const state = this.registry.requireState();
      const archived = new Set(state.archivedSessionIds);
      for (const { member } of restored) if (member.id === group.sessionId || member.archived) archived.add(member.id);
      const pinned = new Set(state.pinnedSessionIds.filter((id2) => !archived.has(id2)));
      for (const { member } of restored) if (member.pinned && !archived.has(member.id)) pinned.add(member.id);
      await this.registry.setState({ ...state, archivedSessionIds: [...archived], pinnedSessionIds: [...pinned] });
    });
    for (const { member, snapshot } of restored) {
      const header = snapshot.header;
      const projections = this.cache?.cachedSnapshot(header);
      this.ctx.emit("api-session/added", {
        sessionId: member.id,
        updatedAt: header.createdAt,
        agentAvailable: false,
        running: false,
        blank: false,
        ...snapshot.formatStatus ? { formatStatus: snapshot.formatStatus } : {},
        ...typeof header.cwd === "string" ? { cwd: header.cwd } : {},
        ...typeof header.parentSession === "string" ? { parentSessionId: header.parentSession } : {},
        ...typeof header.origin === "string" ? { origin: header.origin } : {},
        projections: { kind: "cached", asOfSeq: 0, values: { ...projections?.values ?? {}, title: member.title } }
      });
    }
  }
};

// src/service.ts
import { createHash as createHash3, randomUUID as randomUUID3 } from "node:crypto";

// src/storage.ts
import { randomUUID, createHash as createHash2 } from "node:crypto";
import { open as open3, mkdir as mkdir2, lstat as lstat3, realpath as realpath3, readdir as readdir2, rename, unlink, rmdir } from "node:fs/promises";
import { basename as basename2, dirname as dirname2, join as join2, posix, resolve as resolve3, win32 as win323 } from "node:path";
var UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
var LOG = /^session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/;
var TEMP = /^(?:session\.migration\.[\w.-]+\.tmp|session(?:\.v\d+)?\.jsonl(?:\.zstd)?\.[a-f\d]+\.tmp)$/i;
function directoryPublicationPaths(root, firstCreated, platform = process.platform) {
  const paths = platform === "win32" ? win323 : posix;
  assertLocalStoragePath(root, platform);
  const normalizedRoot = paths.resolve(root);
  const created = platform === "win32" && firstCreated?.startsWith("\\\\?\\") ? firstCreated.slice(4) : firstCreated;
  if (created !== void 0) assertLocalStoragePath(created, platform);
  const boundary = created === void 0 ? normalizedRoot : paths.resolve(created);
  const relative4 = paths.relative(boundary, normalizedRoot);
  if (paths.isAbsolute(relative4) || relative4 === ".." || relative4.startsWith(`..${paths.sep}`))
    throw new ArchiveError("unsafe-path", "The created storage directory is not an ancestor of the plugin root.");
  const count = (relative4 === "" ? 0 : relative4.split(paths.sep).length) + 2;
  const result2 = [];
  let current = normalizedRoot;
  for (let index = 0; index < count; index++) {
    result2.push(current);
    const parent = paths.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return result2;
}
async function exists(path) {
  try {
    await lstat3(path);
    return true;
  } catch (e) {
    if (isMissing(e)) return false;
    throw e;
  }
}
function isMissing(e) {
  return !!e && typeof e === "object" && "code" in e && e.code === "ENOENT";
}
function id(value) {
  if (!UUID.test(value)) throw new ArchiveError("invalid-id", "Invalid operation or trash identifier.");
  return value;
}
function sessionDirectoryName(value) {
  if (value === ".") return "~002E";
  if (value === "..") return "~002E~002E";
  return value.replace(/[^A-Za-z0-9._-]/g, (character) => `~${character.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`);
}
async function atomicJson(path, value) {
  const encoded = `${JSON.stringify(value)}
`;
  if (Buffer.byteLength(encoded) > 8 * 1024 * 1024)
    throw new ArchiveError("metadata-too-large", "Recovery metadata is too large. Select a smaller batch.");
  const tmp = `${path}.${randomUUID()}.tmp`;
  const h = await open3(tmp, "wx", 384);
  try {
    try {
      await h.writeFile(encoded);
      await h.sync();
    } finally {
      await h.close();
    }
    await rename(tmp, path);
    await syncDirectory(dirname2(path));
  } catch (e) {
    await unlink(tmp).catch(() => {
    });
    throw e;
  }
}
function validateGroup(value) {
  if (!value || typeof value !== "object") throw new ArchiveError("corrupt-state", "Invalid recovery metadata.");
  const g = value;
  if (typeof g.sessionId !== "string" || typeof g.title !== "string" || typeof g.sessionsRoot !== "string" || !Array.isArray(g.members) || !g.members.length || g.members.length > 1e3 || g.members.some((m) => !m || typeof m.id !== "string" || typeof m.directory !== "string" || typeof m.revision !== "string" || typeof m.title !== "string" || !m.header || typeof m.header !== "object"))
    throw new ArchiveError("corrupt-state", "Invalid recovery metadata.");
  if (new Set(g.members.map((m) => m.id)).size !== g.members.length || new Set(g.members.map((m) => process.platform === "win32" ? resolve3(m.directory).toLowerCase() : resolve3(m.directory))).size !== g.members.length)
    throw new ArchiveError("corrupt-state", "Recovery targets are ambiguous.");
  if (!g.members.some((m) => m.id === g.sessionId) || g.members.some((m) => m.header.id !== m.id || typeof m.archived !== "boolean" || !Array.isArray(m.activity) || !Number.isFinite(m.sizeBytes) || m.sizeBytes < 0))
    throw new ArchiveError("corrupt-state", "Recovery identities do not match.");
}
function groupFingerprint(group) {
  return createHash2("sha256").update(JSON.stringify({
    root: resolve3(group.sessionsRoot),
    sessionId: group.sessionId,
    members: group.members.map((m) => ({
      id: m.id,
      directory: resolve3(m.directory),
      revision: m.revision,
      archived: m.archived,
      header: m.header
    })).sort((a, b) => a.id.localeCompare(b.id))
  })).digest("hex");
}
var TrashStore = class {
  root;
  sessionsRoot;
  issues = [];
  constructor(options) {
    this.root = resolve3(options.root);
    this.sessionsRoot = resolve3(options.sessionsRoot);
  }
  area(name2) {
    return join2(this.root, name2);
  }
  operationPath(opId) {
    return join2(this.area("operations"), `${id(opId)}.json`);
  }
  stage(entryId) {
    return join2(this.area("staging"), id(entryId));
  }
  entry(entryId) {
    return join2(this.area("trash"), id(entryId));
  }
  listIssues() {
    return this.issues;
  }
  async sync(path) {
    await syncDirectory(path);
  }
  async initialize() {
    assertLocalStoragePath(this.root);
    assertLocalStoragePath(this.sessionsRoot);
    await assertPlainDirectory(this.sessionsRoot);
    if (isWithin(this.sessionsRoot, this.root) || samePath(this.root, this.sessionsRoot))
      throw new ArchiveError("unsafe-path", "Trash must be outside the session store.");
    const createdRoot = !await exists(this.root) ? await mkdir2(this.root, { mode: 448, recursive: true }) : void 0;
    await assertPrivateDirectory(this.root);
    const canonicalRoot = await realpath3(this.root);
    const canonicalSessions = await realpath3(this.sessionsRoot);
    assertLocalStoragePath(canonicalRoot);
    assertLocalStoragePath(canonicalSessions);
    await assertCanonicalStoragePath(this.root, canonicalRoot);
    await assertCanonicalStoragePath(this.sessionsRoot, canonicalSessions);
    if (isWithin(canonicalSessions, canonicalRoot) || samePath(canonicalRoot, canonicalSessions))
      throw new ArchiveError("unsafe-path", "Trash must be outside the session store.");
    for (const name2 of ["operations", "staging", "trash", "receipts"]) {
      const p = this.area(name2);
      if (!await exists(p)) await mkdir2(p, { mode: 448 });
      await assertPrivateDirectory(p);
    }
    const publishedRoot = createdRoot && process.platform === "win32" ? await realpath3(createdRoot) : createdRoot;
    for (const path of directoryPublicationPaths(this.root, publishedRoot)) await this.sync(path);
    if ((await lstat3(this.root)).dev !== (await lstat3(this.sessionsRoot)).dev)
      throw new ArchiveError("cross-volume", "Trash and sessions must be on the same volume.");
  }
  async readJson(path) {
    return readBoundedJson(path);
  }
  async validateSource(group, allowMissing = false) {
    validateGroup(group);
    assertLocalStoragePath(group.sessionsRoot);
    if (!samePath(group.sessionsRoot, this.sessionsRoot)) throw new ArchiveError("unsafe-path", "Session store changed.");
    await assertPlainDirectory(this.sessionsRoot);
    const root = await realpath3(this.sessionsRoot);
    for (const member of group.members) {
      assertLocalStoragePath(member.directory);
      const directory = resolve3(member.directory);
      if (!isWithin(this.sessionsRoot, directory) || !samePath(dirname2(dirname2(directory)), this.sessionsRoot) || basename2(directory) !== sessionDirectoryName(member.id))
        throw new ArchiveError("unsafe-path", "Session directory is outside the expected layout.");
      try {
        await assertPlainDirectory(dirname2(directory));
      } catch (error2) {
        if (allowMissing && isMissing(error2)) continue;
        throw error2;
      }
      const canonicalParent = await realpath3(dirname2(directory));
      assertLocalStoragePath(canonicalParent);
      if (!samePath(dirname2(canonicalParent), root))
        throw new ArchiveError("unsafe-path", "Session parent directory is unsafe.");
      if (!await exists(directory)) {
        if (allowMissing) continue;
        throw new ArchiveError("missing-session", "Session data no longer exists.");
      }
      if ((await lstat3(directory)).dev !== (await lstat3(this.root)).dev)
        throw new ArchiveError("cross-volume", "Session data and trash must be on the same volume.");
      await this.validateContents(directory);
    }
  }
  async validateContents(directory) {
    await assertPlainDirectory(directory);
    const names = await readdir2(directory);
    let logs2 = 0;
    for (const name2 of names) {
      if (!(LOG.test(name2) || TEMP.test(name2) || name2 === "session.lock"))
        throw new ArchiveError("unknown-file", "An unexpected file prevents this operation.");
      const s = await lstat3(join2(directory, name2));
      if (!s.isFile() || s.isSymbolicLink()) throw new ArchiveError("unsafe-path", "Session data contains an unsafe entry.");
      if (LOG.test(name2)) logs2++;
    }
    if (!logs2) throw new ArchiveError("missing-log", "The session log is missing.");
    return names;
  }
  async writeOperation(operation) {
    await atomicJson(this.operationPath(operation.id), operation);
  }
  async cleanTemporaryFiles() {
    const clean = async (directory) => {
      await assertPrivateDirectory(directory);
      for (const name2 of await readdir2(directory)) {
        if (!/^(?:[a-f\d-]{36}\.json|manifest\.json)\.[a-f\d-]{36}\.tmp$/i.test(name2)) continue;
        const path = join2(directory, name2);
        const st = await lstat3(path);
        if (!st.isFile() || st.isSymbolicLink()) throw new ArchiveError("unsafe-path", "A recovery temporary is unsafe.");
        await unlink(path);
      }
    };
    for (const area of ["operations", "receipts"]) await clean(this.area(area));
    for (const area of ["staging", "trash"]) for (const entry of await readdir2(this.area(area))) {
      if (UUID.test(entry)) await clean(join2(this.area(area), entry));
    }
  }
  async operations() {
    if (!await exists(this.area("operations"))) return [];
    const result2 = [];
    for (const name2 of (await readdir2(this.area("operations"))).sort()) {
      if (!name2.endsWith(".json")) continue;
      const value = await this.readJson(join2(this.area("operations"), name2));
      if (!value || typeof value !== "object") throw new ArchiveError("corrupt-state", "Unknown operation journal.");
      validateGroup(value.group);
      if (value.schema !== 1 || !UUID.test(value.id) || !UUID.test(value.entryId) || basename2(this.operationPath(value.id)) !== name2 || !["pending", "moving", "detached", "trashed", "restoring", "restored-metadata", "restored", "purging", "purged"].includes(value.phase) || !Array.isArray(value.moved) || value.moved.some((n) => !Number.isInteger(n) || n < 0 || n >= value.group.members.length) || value.requestId !== void 0 && (!UUID.test(value.requestId) || typeof value.targetId !== "string"))
        throw new ArchiveError("corrupt-state", "Unknown operation journal.");
      await this.validateSource(value.group, true);
      result2.push(value);
    }
    return result2;
  }
  async queue(group, reason, context) {
    const pending = (await this.operations()).find((o) => o.phase === "pending" && o.group.sessionId === group.sessionId);
    if (pending) return;
    const key = randomUUID();
    await this.writeOperation({ schema: 1, id: key, entryId: key, phase: "pending", group, createdAt: Date.now(), moved: [], reason, ...context });
  }
  async cancelPending(sessionId) {
    const pending = (await this.operations()).filter((o) => o.phase === "pending" && o.group.sessionId === sessionId);
    for (const op of pending) await this.finish(op);
    return pending.length > 0;
  }
  async prepareTrash(group, pending, context) {
    await this.validateSource(group);
    const key = pending?.id ?? randomUUID();
    const op = {
      schema: 1,
      id: key,
      entryId: pending?.entryId ?? key,
      phase: "moving",
      group,
      createdAt: pending?.createdAt ?? Date.now(),
      moved: [],
      ...pending?.requestId ? { requestId: pending.requestId, targetId: pending.targetId } : context
    };
    await this.writeOperation(op);
    const stage = this.stage(op.entryId);
    if (await exists(stage) || await exists(this.entry(op.entryId))) throw new ArchiveError("conflict", "A trash entry already exists.");
    await mkdir2(stage, { mode: 448 });
    await this.sync(this.area("staging"));
    await atomicJson(join2(stage, "manifest.json"), { schema: 1, id: op.entryId, group, trashedAt: Date.now() });
    for (const [i, member] of group.members.entries()) {
      await rename(member.directory, join2(stage, String(i)));
      await syncDirectory(dirname2(member.directory));
      await syncDirectory(stage);
      op.moved.push(i);
      await this.writeOperation(op);
    }
    return op;
  }
  async markDetached(op) {
    op.phase = "detached";
    await this.writeOperation(op);
  }
  async commitTrash(op) {
    await rename(this.stage(op.entryId), this.entry(op.entryId));
    await syncDirectory(this.area("trash"));
    await syncDirectory(this.area("staging"));
    op.phase = "trashed";
    await this.writeOperation(op);
  }
  async rollbackTrash(op) {
    await this.validateSource(op.group, true);
    const stage = this.stage(op.entryId);
    if (!await exists(stage)) {
      if (await exists(this.entry(op.entryId))) throw new ArchiveError("already-committed", "The trash move is already committed.");
      for (const m of op.group.members) if (!await exists(m.directory)) throw new ArchiveError("recovery-required", "Recovery needs attention.");
      return;
    }
    await this.validateContainer(stage, op.group);
    for (let i = op.group.members.length - 1; i >= 0; i--) {
      const m = op.group.members[i];
      const staged = join2(stage, String(i));
      if (!await exists(staged)) continue;
      if (await exists(m.directory)) throw new ArchiveError("restore-conflict", "Recovery would overwrite existing session data.");
      await rename(staged, m.directory);
      await syncDirectory(dirname2(m.directory));
    }
    await unlink(join2(stage, "manifest.json")).catch((e) => {
      if (!isMissing(e)) throw e;
    });
    await rmdir(stage);
    await syncDirectory(this.area("staging"));
  }
  async finish(op) {
    await unlink(this.operationPath(op.id)).catch((e) => {
      if (!isMissing(e)) throw e;
    });
    await syncDirectory(this.area("operations"));
  }
  async hasEntry(entryId) {
    return exists(this.entry(entryId));
  }
  async assertCommittedTrash(op) {
    const manifest = await this.manifest(op.entryId);
    if (groupFingerprint(manifest.group) !== groupFingerprint(op.group) || await exists(this.stage(op.entryId)))
      throw new ArchiveError("corrupt-state", "The committed trash entry does not match its operation.");
    for (const [i, member] of op.group.members.entries()) {
      await this.validateContents(join2(this.entry(op.entryId), String(i)));
      if (await exists(member.directory)) throw new ArchiveError("restore-conflict", "The original session still exists. Recovery needs attention.");
    }
  }
  async locations(op) {
    await this.validateSource(op.group, true);
    const locations = [];
    for (const [i, member] of op.group.members.entries()) {
      const candidates = [member.directory, join2(this.stage(op.entryId), String(i)), join2(this.entry(op.entryId), String(i))];
      const found = [];
      for (const path of candidates) if (await exists(path)) {
        await assertPlainDirectory(path);
        found.push(path);
      }
      if (found.length > 1) throw new ArchiveError("restore-conflict", "Recovery found conflicting copies of a session.");
      locations.push(found[0]);
    }
    return locations;
  }
  async entryLocations(entryId) {
    const m = await this.manifest(entryId);
    const paths = [];
    for (let i = 0; i < m.group.members.length; i++) {
      const p = join2(this.entry(entryId), String(i));
      paths.push(await exists(p) ? p : void 0);
    }
    return paths;
  }
  async completeEmptyPurge(op) {
    const path = this.entry(op.entryId);
    if (!await exists(path)) {
      await this.sync(this.area("trash"));
      return true;
    }
    const unchanged = await this.directoryGuard(path);
    await this.validateContainer(path, op.group, true);
    for (let i = 0; i < op.group.members.length; i++) if (await exists(join2(path, String(i)))) return false;
    if (await exists(join2(path, "manifest.json"))) {
      const manifest = await this.manifest(op.entryId);
      if (groupFingerprint(manifest.group) !== groupFingerprint(op.group))
        throw new ArchiveError("corrupt-state", "The interrupted deletion does not match its trash manifest.");
    }
    await unchanged();
    await this.sync(path);
    await unchanged();
    await this.assertEmptyEntry(path);
    await unlink(join2(path, "manifest.json")).catch((e) => {
      if (!isMissing(e)) throw e;
    });
    await this.sync(path);
    await unchanged();
    await rmdir(path);
    await this.sync(this.area("trash"));
    return true;
  }
  async manifest(entryId) {
    const directory = this.entry(entryId);
    await assertPlainDirectory(directory);
    let m;
    try {
      m = await this.readJson(join2(directory, "manifest.json"));
    } catch (error2) {
      if (isMissing(error2)) throw new ArchiveError("corrupt-state", "The trash manifest is missing. Its remaining data was left untouched.");
      throw error2;
    }
    if (!m || m.schema !== 1 || m.id !== entryId || !Number.isFinite(m.trashedAt)) throw new ArchiveError("corrupt-state", "Invalid trash manifest.");
    validateGroup(m.group);
    await this.validateSource(m.group, true);
    await this.validateContainer(directory, m.group, true);
    return m;
  }
  async checkRestore(entryId) {
    if ((await this.operations()).some((o) => o.entryId === entryId && o.phase === "purging"))
      throw new ArchiveError("purge-interrupted", "Permanent deletion began for this entry. Only an explicit purge retry is available.");
    const manifest = await this.manifest(entryId);
    for (const [i, member] of manifest.group.members.entries()) {
      await this.validateContents(join2(this.entry(entryId), String(i)));
      if (await exists(member.directory)) throw new ArchiveError("restore-conflict", "The original session location is already occupied.");
    }
  }
  async entrySnapshot(entryId) {
    return this.measureEntry(entryId, await this.operations());
  }
  async measureEntry(entryId, operations) {
    const entry = this.entry(entryId);
    const manifestPath = join2(entry, "manifest.json");
    const signature3 = (st) => `${st.dev}:${st.ino}:${st.mode}:${st.size}:${st.mtimeNs}:${st.ctimeNs}`;
    const identity = (st) => `${st.dev}:${st.ino}:${st.mode}`;
    const changed2 = () => new ArchiveError("source-changed", "Trash data changed while measuring it. Review the entry again.");
    const entryBefore = await lstat3(entry, { bigint: true });
    const manifestBefore = await lstat3(manifestPath, { bigint: true });
    if (!manifestBefore.isFile() || manifestBefore.isSymbolicLink()) throw new ArchiveError("unsafe-path", "The trash manifest is unsafe.");
    const manifest = await this.manifest(entryId);
    const entryNames = (await readdir2(entry)).sort();
    const allowed = /* @__PURE__ */ new Set(["manifest.json", ...manifest.group.members.map((_, i) => String(i))]);
    if (entryNames.some((name2) => !allowed.has(name2))) throw new ArchiveError("unknown-file", "Unexpected data prevents measuring this entry.");
    const partial = operations.some((operation) => operation.entryId === entryId && ["purging", "purged"].includes(operation.phase) && groupFingerprint(operation.group) === groupFingerprint(manifest.group));
    const hash = createHash2("sha256").update(JSON.stringify(manifest));
    const observed = [];
    const members = [];
    let size = 0n;
    let logs2 = 0n;
    for (let i = 0; i < manifest.group.members.length; i++) {
      const directory = join2(entry, String(i));
      if (!await exists(directory)) {
        if (!partial) throw new ArchiveError("corrupt-state", "A trash member is missing without a permanent deletion journal.");
        hash.update(`missing:${i}`);
        members.push({ path: directory, names: [] });
        continue;
      }
      const directoryBefore = await lstat3(directory, { bigint: true });
      if (!directoryBefore.isDirectory() || directoryBefore.isSymbolicLink()) throw new ArchiveError("unsafe-path", "A trash member is unsafe.");
      const names = (await readdir2(directory)).sort();
      let logCount = 0;
      hash.update(`present:${i}`);
      members.push({ path: directory, identity: identity(directoryBefore), names: names.filter((name2) => name2 !== "session.lock") });
      for (const name2 of names) {
        if (!(LOG.test(name2) || TEMP.test(name2) || name2 === "session.lock")) throw new ArchiveError("unknown-file", "Unexpected data prevents measuring this entry.");
        const path = join2(directory, name2);
        const st = await lstat3(path, { bigint: true });
        if (!st.isFile() || st.isSymbolicLink()) throw new ArchiveError("unsafe-path", "A trash file is unsafe.");
        if (name2 === "session.lock") continue;
        if (st.size < 0n) throw new ArchiveError("corrupt-state", "A trash file has an invalid size.");
        observed.push({ path, signature: signature3(st) });
        size += st.size;
        if (LOG.test(name2)) {
          logs2 += st.size;
          logCount++;
        }
        hash.update(`${i}:${name2}:${signature3(st)}`);
      }
      if (!partial && !logCount) throw new ArchiveError("missing-log", "The trash member log is missing.");
    }
    if (size > BigInt(Number.MAX_SAFE_INTEGER)) throw new ArchiveError("corrupt-state", "Trash file sizes exceed the supported range.");
    try {
      const finalManifest = await this.manifest(entryId);
      if (JSON.stringify(finalManifest) !== JSON.stringify(manifest) || signature3(await lstat3(manifestPath, { bigint: true })) !== signature3(manifestBefore) || identity(await lstat3(entry, { bigint: true })) !== identity(entryBefore)) throw changed2();
      for (const member of members) {
        if (member.identity === void 0) {
          if (await exists(member.path)) throw changed2();
          continue;
        }
        const st = await lstat3(member.path, { bigint: true });
        if (!st.isDirectory() || st.isSymbolicLink() || identity(st) !== member.identity || JSON.stringify((await readdir2(member.path)).filter((name2) => name2 !== "session.lock").sort()) !== JSON.stringify(member.names)) throw changed2();
      }
      for (const file of observed) {
        const st = await lstat3(file.path, { bigint: true });
        if (!st.isFile() || st.isSymbolicLink() || signature3(st) !== file.signature) throw changed2();
      }
      if (signature3(await lstat3(manifestPath, { bigint: true })) !== signature3(manifestBefore) || JSON.stringify((await readdir2(entry)).sort()) !== JSON.stringify(entryNames)) throw changed2();
    } catch {
      throw changed2();
    }
    return { manifest, sizeBytes: Number(size), logBytes: Number(logs2), fileCount: observed.length, fingerprint: hash.digest("hex") };
  }
  async entryFingerprint(entryId) {
    return (await this.entrySnapshot(entryId)).fingerprint;
  }
  async validateContainer(directory, group, allowPartial = false) {
    await assertPlainDirectory(directory);
    const allowed = /* @__PURE__ */ new Set(["manifest.json", ...group.members.map((_, i) => String(i))]);
    for (const name2 of await readdir2(directory)) {
      if (!allowed.has(name2)) throw new ArchiveError("unknown-file", "An unexpected trash entry prevents this operation.");
      if (name2 !== "manifest.json") {
        const p = join2(directory, name2);
        if (allowPartial) await this.validatePartialContents(p);
        else await this.validateContents(p);
      }
    }
  }
  async validatePartialContents(directory) {
    await assertPlainDirectory(directory);
    for (const name2 of await readdir2(directory)) {
      const st = await lstat3(join2(directory, name2));
      if (!(LOG.test(name2) || TEMP.test(name2) || name2 === "session.lock") || !st.isFile() || st.isSymbolicLink())
        throw new ArchiveError("unknown-file", "Unexpected data prevents permanent deletion.");
    }
  }
  async list() {
    this.issues = [];
    if (!await exists(this.area("trash"))) return [];
    await assertPrivateDirectory(this.area("trash"));
    const entries = [];
    const operations = await this.operations();
    const byEntry = /* @__PURE__ */ new Map();
    for (const operation of operations) {
      const group = byEntry.get(operation.entryId) ?? [];
      group.push(operation);
      byEntry.set(operation.entryId, group);
    }
    for (const key of await readdir2(this.area("trash"))) {
      try {
        if (!UUID.test(key)) throw new ArchiveError("corrupt-state", "An unknown trash entry needs attention. Its data was left untouched.");
        const journals = byEntry.get(key) ?? [];
        await assertPlainDirectory(this.entry(key));
        if (journals.some((o) => o.phase === "restored-metadata" || o.phase === "restored")) continue;
        if (!await exists(join2(this.entry(key), "manifest.json")) && journals.some((o) => o.phase === "purging" || o.phase === "purged")) {
          await this.assertEmptyEntry(this.entry(key));
          continue;
        }
        const { manifest: m, sizeBytes } = await this.measureEntry(key, journals);
        entries.push({
          id: key,
          sessionId: m.group.sessionId,
          title: m.group.title,
          trashedAt: m.trashedAt,
          sizeBytes,
          memberCount: m.group.members.length
        });
      } catch (error2) {
        const detail = error2 instanceof ArchiveError ? error2 : isMissing(error2) ? new ArchiveError("corrupt-state", "A trash entry is incomplete. Its remaining data was left untouched.") : new ArchiveError("entry-unavailable", "A trash entry could not be read. Its data was left untouched.");
        this.issues.push({ scope: "trash", id: key, code: detail.code, message: detail.message });
      }
    }
    return entries.sort((a, b) => b.trashedAt - a.trashedAt);
  }
  async prepareRestore(entryId, context) {
    await this.checkRestore(entryId);
    const manifest = await this.manifest(entryId);
    for (const member of manifest.group.members) if (await exists(member.directory))
      throw new ArchiveError("restore-conflict", "The original session location is already occupied.");
    const op = { schema: 1, id: randomUUID(), entryId, phase: "restoring", group: manifest.group, createdAt: Date.now(), moved: [], ...context };
    await this.writeOperation(op);
    for (const [i, member] of op.group.members.entries()) {
      const path = join2(this.entry(entryId), String(i));
      await this.validateContents(path);
      await rename(path, member.directory);
      await syncDirectory(dirname2(member.directory));
      await syncDirectory(this.entry(entryId));
      op.moved.push(i);
      await this.writeOperation(op);
    }
    return op;
  }
  async markRestored(op) {
    op.phase = "restored-metadata";
    await this.writeOperation(op);
  }
  async commitRestore(op) {
    const entry = this.entry(op.entryId);
    if (await exists(entry)) {
      await this.validateContainer(entry, op.group, true);
      await unlink(join2(entry, "manifest.json")).catch((e) => {
        if (!isMissing(e)) throw e;
      });
      await rmdir(entry);
    }
    await syncDirectory(this.area("trash"));
    op.phase = "restored";
    await this.writeOperation(op);
  }
  async rollbackRestore(op) {
    await this.validateSource(op.group, true);
    const entry = this.entry(op.entryId);
    await this.validateContainer(entry, op.group);
    for (let i = op.group.members.length - 1; i >= 0; i--) {
      const member = op.group.members[i];
      const target = join2(entry, String(i));
      if (await exists(target)) continue;
      await this.validateContents(member.directory);
      await rename(member.directory, target);
      await syncDirectory(entry);
      await syncDirectory(dirname2(member.directory));
    }
  }
  async purge(entryId, context) {
    const directory = this.entry(entryId);
    const unchanged = await this.directoryGuard(directory);
    const m = await this.readJson(join2(directory, "manifest.json"));
    if (!m || m.schema !== 1 || m.id !== entryId) throw new ArchiveError("corrupt-state", "Invalid trash manifest.");
    validateGroup(m.group);
    await this.validateSource(m.group, true);
    await this.validateContainer(directory, m.group, true);
    const members = [];
    for (let i = 0; i < m.group.members.length; i++) {
      const path = join2(directory, String(i));
      if (await exists(path)) members.push({ path, unchanged: await this.directoryGuard(path) });
    }
    const op = { schema: 1, id: randomUUID(), entryId, phase: "purging", group: m.group, createdAt: Date.now(), moved: [], ...context };
    await this.writeOperation(op);
    for (const member of members) {
      await unchanged();
      await member.unchanged();
      for (const file of await readdir2(member.path)) {
        const path = join2(member.path, file);
        const st = await lstat3(path);
        if (!(LOG.test(file) || TEMP.test(file) || file === "session.lock") || !st.isFile() || st.isSymbolicLink())
          throw new ArchiveError("unknown-file", "Unexpected data prevents permanent deletion.");
        await unchanged();
        await member.unchanged();
        await unlink(path);
      }
      await unchanged();
      await member.unchanged();
      await this.sync(member.path);
      await unchanged();
      await member.unchanged();
      await rmdir(member.path);
      await this.sync(directory);
    }
    await unchanged();
    await this.sync(directory);
    await unchanged();
    await this.assertEmptyEntry(directory);
    await unlink(join2(directory, "manifest.json"));
    await this.sync(directory);
    await unchanged();
    await rmdir(directory);
    await this.sync(this.area("trash"));
    op.phase = "purged";
    await this.writeOperation(op);
    return op;
  }
  async assertEmptyEntry(directory) {
    if ((await readdir2(directory)).some((name2) => name2 !== "manifest.json"))
      throw new ArchiveError("unknown-file", "Unexpected data remains in the trash entry. Its manifest was retained.");
  }
  /** Recheck each owned directory immediately before path-based deletion. Node
   * has no portable unlinkat; this does not promise immunity to a same-user
   * adversary changing a parent during the final filesystem syscall. */
  async directoryGuard(path) {
    const before = await lstat3(path, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink())
      throw new ArchiveError("unsafe-path", "A trash directory is unsafe.");
    const canonical = await realpath3(path);
    await assertCanonicalStoragePath(path, canonical);
    const check = async () => {
      const current = await lstat3(path, { bigint: true });
      if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== before.dev || current.ino !== before.ino || !samePath(await realpath3(path), canonical))
        throw new ArchiveError("unsafe-path", "A trash directory changed during permanent deletion.");
    };
    await check();
    return check;
  }
};

// src/request-journal.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import { lstat as lstat4, open as open4, readdir as readdir3, rename as rename2, unlink as unlink2 } from "node:fs/promises";
import { join as join3, resolve as resolve4 } from "node:path";
var UUID2 = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
var STATUSES = /* @__PURE__ */ new Set(["moved", "pending", "restored", "purged", "cancelled", "skipped", "failed"]);
function missing(error2) {
  return !!error2 && typeof error2 === "object" && "code" in error2 && error2.code === "ENOENT";
}
function requestId(value) {
  if (!UUID2.test(value)) throw new ArchiveError("invalid-request", "A valid request identifier is required.");
  return value;
}
function counts(items) {
  return {
    succeeded: items.filter((item) => ["moved", "restored", "purged", "cancelled"].includes(item.status)).length,
    pending: items.filter((item) => item.status === "pending").length,
    skipped: items.filter((item) => item.status === "skipped").length,
    failed: items.filter((item) => item.status === "failed").length
  };
}
function object2(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function validItem(value) {
  return object2(value) && typeof value.id === "string" && value.id.length > 0 && value.id.length <= 512 && typeof value.title === "string" && typeof value.status === "string" && STATUSES.has(value.status) && (value.code === void 0 || typeof value.code === "string") && (value.message === void 0 || typeof value.message === "string");
}
function validate(value, id2) {
  if (!object2(value) || value.schema !== 1 || value.requestId !== id2 || typeof value.fingerprint !== "string" || typeof value.complete !== "boolean" || !object2(value.result) || value.result.operationId !== id2 || !["trash", "restore", "purge", "cancel"].includes(String(value.result.action)) || !Array.isArray(value.result.items) || value.result.items.length > 100 || !value.result.items.every(validItem) || new Set(value.result.items.map((item) => item.id)).size !== value.result.items.length)
    throw new ArchiveError("corrupt-state", "A request receipt is invalid.");
  if (value.complete) {
    if (value.preview !== void 0 || value.groups !== void 0 || value.fingerprints !== void 0 || value.result.items.some((item) => item.title !== ""))
      throw new ArchiveError("corrupt-state", "A completed request receipt retains recovery content.");
  } else if (!object2(value.preview) || typeof value.preview.id !== "string" || !["trash", "restore", "purge"].includes(String(value.preview.action)) || value.preview.action !== value.result.action && !(value.result.action === "cancel" && value.preview.action === "trash") || !Array.isArray(value.preview.items) || !value.preview.items.length || value.preview.items.length > 100 || !value.preview.items.every((item) => object2(item) && typeof item.id === "string" && item.id.length > 0 && item.id.length <= 512 && typeof item.title === "string") || new Set(value.preview.items.map((item) => item.id)).size !== value.preview.items.length || !object2(value.groups) || !object2(value.fingerprints)) {
    throw new ArchiveError("corrupt-state", "An incomplete request receipt is invalid.");
  }
}
var RequestJournal = class {
  directory;
  tail = Promise.resolve();
  recentIndex;
  indexedDirectory;
  constructor(root) {
    this.directory = join3(resolve4(root), "receipts");
  }
  path(id2) {
    return join3(this.directory, `${requestId(id2)}.json`);
  }
  serialize(work) {
    const next = this.tail.then(work, work);
    this.tail = next.catch(() => {
    });
    return next;
  }
  async directorySafe() {
    await assertPrivateDirectory(this.directory);
  }
  async read(id2, fingerprint) {
    const path = this.path(id2);
    let value;
    try {
      value = await readBoundedJson(path);
    } catch (error2) {
      if (missing(error2)) return void 0;
      throw error2;
    }
    validate(value, id2);
    if (fingerprint !== void 0 && value.fingerprint !== fingerprint)
      throw new ArchiveError("request-conflict", "This request identifier was already used.");
    value.result.counts = counts(value.result.items);
    return value;
  }
  async write(record3, budget = 8 * 1024 * 1024) {
    await this.directorySafe();
    const encoded = `${JSON.stringify(record3)}
`;
    if (Buffer.byteLength(encoded) > budget)
      throw new ArchiveError("metadata-too-large", "Recovery metadata is too large. Select a smaller batch.");
    const path = this.path(record3.requestId);
    const temporary = `${path}.${randomUUID2()}.tmp`;
    const updateIndex = this.indexedDirectory !== void 0 && this.indexedDirectory === await this.directoryIdentity();
    let handle;
    try {
      handle = await open4(temporary, "wx", 384);
      await handle.writeFile(encoded);
      await handle.sync();
      await handle.close();
      handle = void 0;
      await rename2(temporary, path);
      await syncDirectory(this.directory);
      if (updateIndex && this.recentIndex) {
        const remaining = this.recentIndex.filter((item) => item.id !== record3.requestId);
        if (record3.complete) remaining.push({ id: record3.requestId, mtime: (await lstat4(path)).mtimeMs });
        this.recentIndex = this.newest(remaining);
        this.indexedDirectory = await this.directoryIdentity();
      } else this.indexedDirectory = void 0;
    } catch (error2) {
      if (handle) await handle.close().catch(() => {
      });
      await unlink2(temporary).catch(() => {
      });
      throw error2;
    }
  }
  async discardTemps(id2) {
    const names = await readdir3(this.directory);
    let changed2 = false;
    for (const name2 of names) {
      const match = /^(.+)\.json\.(.+)\.tmp$/.exec(name2);
      if (!match || !UUID2.test(match[1]) || !UUID2.test(match[2]) || id2 !== void 0 && match[1] !== id2) continue;
      const path = join3(this.directory, name2);
      const stat = await lstat4(path);
      if (!stat.isFile() || stat.isSymbolicLink() || process.platform !== "win32" && ((stat.mode & 63) !== 0 || typeof process.getuid === "function" && stat.uid !== process.getuid()))
        throw new ArchiveError("unsafe-path", "A temporary request receipt needs attention.");
      await unlink2(path);
      changed2 = true;
    }
    if (changed2) {
      await syncDirectory(this.directory);
    }
  }
  async begin(id2, fingerprint, context, action) {
    return this.serialize(async () => {
      await this.directorySafe();
      const existing = await this.read(id2, fingerprint);
      if (existing) return existing;
      const record3 = {
        schema: 1,
        requestId: requestId(id2),
        fingerprint,
        complete: false,
        ...structuredClone(context),
        result: { operationId: id2, action: action ?? context.preview.action, items: [], counts: counts([]) }
      };
      validate(record3, id2);
      await this.write(record3, 6 * 1024 * 1024);
      return structuredClone(record3);
    });
  }
  async load(id2, fingerprint) {
    return this.serialize(async () => {
      await this.directorySafe();
      return this.read(id2, fingerprint);
    });
  }
  async record(id2, item) {
    return this.serialize(async () => {
      await this.directorySafe();
      const record3 = await this.read(id2);
      if (!record3) throw new ArchiveError("request-missing", "The durable request intent is missing.");
      if (!validItem(item)) throw new ArchiveError("invalid-request", "The request result is invalid.");
      const targets = record3.complete ? record3.result.items.map((value) => value.id) : record3.preview.items.map((value) => value.id);
      if (!targets.includes(item.id)) throw new ArchiveError("request-conflict", "The result does not belong to this request.");
      const merged = {
        id: item.id,
        title: record3.complete ? "" : item.title.slice(0, 256),
        status: item.status,
        ...item.code === void 0 ? {} : { code: item.code.slice(0, 80) },
        ...item.message === void 0 ? {} : { message: item.message.slice(0, 1024) }
      };
      const resultById = new Map(record3.result.items.map((value) => [value.id, value]));
      resultById.set(item.id, merged);
      record3.result.items = targets.flatMap((target) => {
        const value = resultById.get(target);
        return value ? [value] : [];
      });
      record3.result.counts = counts(record3.result.items);
      await this.write(record3);
      return structuredClone(record3);
    });
  }
  async complete(id2, interrupted = false) {
    return this.serialize(async () => {
      await this.directorySafe();
      const record3 = await this.read(id2);
      if (!record3) throw new ArchiveError("request-missing", "The durable request intent is missing.");
      if (record3.complete) {
        await this.discardTemps(id2);
        return record3.result;
      }
      const saved = new Map(record3.result.items.map((item) => [item.id, item]));
      const absent = record3.preview.items.filter((item) => !saved.has(item.id));
      if (absent.length && !interrupted) throw new ArchiveError("request-incomplete", "Some request targets have no durable result.");
      for (const item of absent) saved.set(item.id, {
        id: item.id,
        title: "",
        status: "failed",
        code: "operation-interrupted",
        message: "The operation was interrupted before this target completed. Review it before retrying."
      });
      record3.result.items = record3.preview.items.map((item) => ({ ...saved.get(item.id), title: "" }));
      record3.result.counts = counts(record3.result.items);
      record3.complete = true;
      delete record3.preview;
      delete record3.groups;
      delete record3.fingerprints;
      await this.write(record3);
      await this.discardTemps(id2);
      return structuredClone(record3.result);
    });
  }
  async records() {
    await this.directorySafe();
    const result2 = [];
    for (const name2 of (await readdir3(this.directory)).sort()) {
      if (!name2.endsWith(".json")) continue;
      const id2 = name2.slice(0, -5);
      requestId(id2);
      const record3 = await this.read(id2);
      if (record3) result2.push(record3);
    }
    return result2;
  }
  /** Startup cleanup is explicit. Listing receipts never removes filesystem entries. */
  async cleanTemporaryFiles() {
    return this.serialize(async () => {
      await this.directorySafe();
      await this.discardTemps();
    });
  }
  async incomplete() {
    return this.serialize(async () => (await this.records()).filter((record3) => !record3.complete));
  }
  async recent() {
    return this.serialize(async () => {
      await this.directorySafe();
      const before = await this.directoryIdentity();
      if (!this.recentIndex || this.indexedDirectory !== before) {
        const names = (await readdir3(this.directory)).filter((name2) => name2.endsWith(".json"));
        const dated = [];
        for (let start = 0; start < names.length; start += 32) {
          const batch = await Promise.all(names.slice(start, start + 32).map(async (name2) => {
            const id2 = requestId(name2.slice(0, -5));
            try {
              return { id: id2, mtime: (await lstat4(this.path(id2))).mtimeMs };
            } catch (error2) {
              if (missing(error2)) return void 0;
              throw error2;
            }
          }));
          for (const item of batch) if (item) dated.push(item);
        }
        dated.sort((a, b) => b.mtime - a.mtime || a.id.localeCompare(b.id));
        const completed = [];
        for (const item of dated) {
          const record3 = await this.read(item.id);
          if (record3?.complete) completed.push(item);
          if (completed.length === 10) break;
        }
        this.recentIndex = completed;
        this.indexedDirectory = before === await this.directoryIdentity() ? before : void 0;
      }
      const recent = [];
      for (const item of this.recentIndex) {
        const record3 = await this.read(item.id);
        if (record3?.complete) recent.push(record3.result);
      }
      return recent;
    });
  }
  async directoryIdentity() {
    const stat = await lstat4(this.directory, { bigint: true });
    return `${stat.dev}:${stat.ino}:${stat.mtimeNs}:${stat.ctimeNs}`;
  }
  newest(items) {
    return items.sort((a, b) => b.mtime - a.mtime || a.id.localeCompare(b.id)).slice(0, 10);
  }
};

// src/service.ts
var REQUEST_ID = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
var MESSAGE = {
  active: "The session or a related task is still in use.",
  "not-archived": "Only archived sessions can be moved to trash.",
  busy: "Another process holds this session. Nothing was moved.",
  "source-changed": "Session data changed. Review a new preview before continuing.",
  "recovery-required": "An interrupted operation needs recovery before this session can be changed."
};
function safeError(error2) {
  if (error2 instanceof ArchiveError) return { code: error2.code, message: error2.message };
  return { code: "operation-failed", message: "The operation could not complete. Its recorded state is available for recovery." };
}
function failure(id2, title, error2) {
  const detail = safeError(error2);
  return { id: id2, title, status: "failed", ...detail };
}
function result(requestId2, action, items) {
  return { operationId: requestId2, action, items, counts: {
    succeeded: items.filter((i) => ["moved", "restored", "purged", "cancelled"].includes(i.status)).length,
    pending: items.filter((i) => i.status === "pending").length,
    skipped: items.filter((i) => i.status === "skipped").length,
    failed: items.filter((i) => i.status === "failed").length
  } };
}
function validateIds(ids2) {
  if (!Array.isArray(ids2) || !ids2.length || ids2.length > 100 || ids2.some((v) => typeof v !== "string" || !v || v.length > 512))
    throw new ArchiveError("invalid-request", "Select between 1 and 100 valid targets.");
  if (new Set(ids2).size !== ids2.length) throw new ArchiveError("invalid-request", "Duplicate targets are not allowed.");
}
function checkRequestId(value) {
  if (!REQUEST_ID.test(value)) throw new ArchiveError("invalid-request", "A valid request identifier is required.");
}
function groupReady(group) {
  const root = group.members.find((m) => m.id === group.sessionId);
  if (!root?.archived) throw new ArchiveError("not-archived", MESSAGE["not-archived"]);
  if (group.members.some((m) => m.activity.length)) throw new ArchiveError("active", MESSAGE.active);
}
var ArchiveService = class {
  constructor(adapter, store) {
    this.adapter = adapter;
    this.store = store;
    this.requests = new RequestJournal(store.root);
  }
  tail = Promise.resolve();
  previews = /* @__PURE__ */ new Map();
  startupFailures = [];
  initialized = false;
  closing = false;
  maintenance;
  listing;
  requests;
  serialize(work) {
    if (this.closing) return Promise.reject(new ArchiveError("plugin-stopping", "The plugin is stopping. Refresh after it reloads."));
    const guarded = () => {
      if (this.maintenance) throw new ArchiveError(this.maintenance, "A plugin update is in progress or waiting for a restart.");
      return work();
    };
    const task = this.tail.then(guarded, guarded);
    this.tail = task.catch(() => {
    });
    return task;
  }
  /** Drain archive work before package replacement, without putting installation
   * inside the tail: HMR may await close() while the native manager still runs. */
  async beginUpdate() {
    return this.serialize(async () => {
      this.maintenance = "update-in-progress";
      return (restartRequired) => {
        this.maintenance = restartRequired ? "update-restart-required" : void 0;
      };
    });
  }
  async close() {
    this.closing = true;
    this.previews.clear();
    await this.tail;
    this.previews.clear();
  }
  async supported() {
    const support = await this.adapter.capabilities();
    if (!support.supported) throw new ArchiveError("unsupported-host", support.reason ?? "This DSH host is not supported.");
  }
  async initialize() {
    return this.serialize(async () => {
      if (this.initialized) return;
      if (!(await this.adapter.capabilities()).supported) {
        this.initialized = true;
        return;
      }
      await this.store.initialize();
      await this.store.cleanTemporaryFiles();
      await this.requests.cleanTemporaryFiles();
      const operations = await this.store.operations();
      for (const op of operations.filter((o) => o.phase !== "pending")) {
        try {
          await this.recover(op);
        } catch (e) {
          this.startupFailures.push(failure(op.group.sessionId, op.group.title, e));
        }
      }
      for (const op of operations.filter((o) => o.phase === "pending")) {
        try {
          if ((await this.store.operations()).some((o) => o.phase !== "pending" && o.group.sessionId === op.group.sessionId))
            throw new ArchiveError("recovery-required", MESSAGE["recovery-required"]);
          const fresh = await this.adapter.inspect(op.group.sessionId);
          groupReady(fresh);
          if (groupFingerprint(fresh) !== groupFingerprint(op.group)) {
            const changed2 = failure(op.targetId ?? op.group.sessionId, op.group.title, new ArchiveError("source-changed", MESSAGE["source-changed"]));
            if (op.requestId) await this.requests.record(op.requestId, changed2);
            await this.store.finish(op);
            this.startupFailures.push(changed2);
            continue;
          }
          const moved = await this.trashGroup(fresh, op, op.requestId ? { requestId: op.requestId, targetId: op.targetId } : void 0);
          if (op.requestId) await this.requests.record(op.requestId, { ...moved, id: op.targetId });
          if (moved.status === "moved") await this.finishTerminals(op.requestId, op.targetId, op.entryId);
          if (moved.status === "failed") this.startupFailures.push(moved);
        } catch (e) {
          const code3 = safeError(e).code;
          if (["not-archived", "source-changed", "missing-session", "session-missing", "session-not-found"].includes(code3)) {
            if (op.requestId) await this.requests.record(op.requestId, failure(op.targetId, op.group.title, e));
            await this.store.finish(op);
          }
          this.startupFailures.push(failure(op.group.sessionId, op.group.title, e));
        }
      }
      for (const request of await this.requests.incomplete()) await this.requests.complete(request.requestId, true);
      this.initialized = true;
    });
  }
  async recover(op) {
    const directories = await this.store.locations(op);
    const held = await this.adapter.acquireLocated(op.group, directories);
    if (held && held.kind !== "acquired") throw new ArchiveError("busy", "Recovery is waiting for the session write lock.");
    let outcome;
    let retain = false;
    try {
      if (op.phase === "moving" || op.phase === "detached" || op.phase === "trashed") {
        if (await this.store.hasEntry(op.entryId)) {
          await this.store.assertCommittedTrash(op);
          await this.adapter.removeRegistry(op.group);
          outcome = { id: op.targetId ?? op.group.sessionId, title: op.group.title, status: "moved" };
        } else {
          await this.store.rollbackTrash(op);
          await this.adapter.restoreRegistry(op.group);
          outcome = failure(op.targetId ?? op.group.sessionId, op.group.title, new ArchiveError("operation-interrupted", "The interrupted move was rolled back. Review before retrying."));
        }
      } else if (op.phase === "restoring" || op.phase === "restored-metadata" || op.phase === "restored") {
        if (op.phase !== "restoring") {
          await this.adapter.restoreRegistry(op.group);
          await this.store.commitRestore(op);
          outcome = { id: op.targetId ?? op.entryId, title: op.group.title, status: "restored" };
        } else {
          await this.store.rollbackRestore(op);
          await this.adapter.removeRegistry(op.group);
          outcome = failure(op.targetId ?? op.entryId, op.group.title, new ArchiveError("operation-interrupted", "The interrupted restore was rolled back. Review before retrying."));
        }
      } else if (op.phase === "purging" || op.phase === "purged") {
        if (await this.store.completeEmptyPurge(op)) outcome = { id: op.targetId ?? op.entryId, title: op.group.title, status: "purged" };
        else {
          outcome = failure(
            op.targetId ?? op.entryId,
            op.group.title,
            new ArchiveError("purge-interrupted", "A permanent deletion was interrupted. Review the entry and retry explicitly.")
          );
          this.startupFailures.push(outcome);
          retain = true;
        }
      }
      if (outcome && op.requestId) await this.requests.record(op.requestId, outcome);
      if (!retain) await this.store.finish(op);
    } finally {
      if (held?.kind === "acquired") await held.lease.release();
    }
  }
  async finishTerminals(requestId2, targetId, purgedEntryId) {
    for (const op of await this.store.operations()) {
      if (purgedEntryId && op.entryId === purgedEntryId && ["purging", "purged"].includes(op.phase)) {
        if (op.requestId) await this.requests.record(op.requestId, { id: op.targetId, title: "", status: "purged" });
        await this.store.finish(op);
      } else if (requestId2 && op.requestId === requestId2 && op.targetId === targetId && ["trashed", "restored", "purged"].includes(op.phase)) await this.store.finish(op);
    }
  }
  async list() {
    if (this.listing) return this.listing;
    const listing = this.serialize(async () => {
      const support = await this.adapter.capabilities();
      if (!support.supported) return { support, archived: [], trash: [], recentResults: [] };
      const pending = new Map((await this.store.operations()).filter((o) => o.phase === "pending").map((o) => [o.group.sessionId, o]));
      const archived = (await this.adapter.listArchived()).map((s) => {
        const p = pending.get(s.id);
        return p ? { ...s, pending: true, pendingReason: p.reason ?? "Waiting for the next DSH start." } : s;
      });
      const recent = await this.requests.recent();
      if (this.startupFailures.length) recent.unshift(result("startup-recovery", "trash", this.startupFailures));
      const trash = await this.store.list();
      const issues = [...this.adapter.listIssues?.() ?? [], ...this.store.listIssues()];
      return { support, archived, trash, recentResults: recent, ...issues.length ? { issues } : {} };
    });
    this.listing = listing;
    try {
      return await listing;
    } finally {
      if (this.listing === listing) this.listing = void 0;
    }
  }
  async preview(action, ids2) {
    return this.serialize(async () => {
      await this.supported();
      validateIds(ids2);
      if (!["trash", "restore", "purge"].includes(action)) throw new ArchiveError("invalid-request", "Unknown operation.");
      const items = [];
      const groups = /* @__PURE__ */ new Map();
      const fingerprints = /* @__PURE__ */ new Map();
      const occupied = /* @__PURE__ */ new Set();
      const operations = await this.store.operations();
      for (const key of ids2) {
        let title = key;
        try {
          if (action === "trash") {
            if (operations.some((o) => o.group.sessionId === key && o.phase !== "pending")) throw new ArchiveError("recovery-required", MESSAGE["recovery-required"]);
            if (operations.some((o) => o.group.sessionId === key && o.phase === "pending")) throw new ArchiveError("already-pending", "This session is already waiting for a restart.");
            const group = await this.adapter.inspect(key);
            title = group.title;
            groupReady(group);
            if (group.members.some((m) => occupied.has(m.id))) throw new ArchiveError("overlapping-targets", "These selections share a related session.");
            group.members.forEach((m) => occupied.add(m.id));
            groups.set(key, group);
            fingerprints.set(key, groupFingerprint(group));
            items.push({
              id: key,
              sessionId: group.sessionId,
              title,
              memberIds: group.members.map((m) => m.id),
              sizeBytes: group.members.reduce((n, m) => n + m.sizeBytes, 0),
              disposition: group.members.some((m) => m.loaded) ? "pending" : "ready"
            });
          } else {
            const snapshot = await this.store.entrySnapshot(key);
            const manifest = snapshot.manifest;
            title = manifest.group.title;
            if (action === "restore") await this.store.checkRestore(key);
            groups.set(key, manifest.group);
            fingerprints.set(key, snapshot.fingerprint);
            items.push({
              id: key,
              sessionId: manifest.group.sessionId,
              title,
              memberIds: manifest.group.members.map((m) => m.id),
              sizeBytes: snapshot.sizeBytes,
              disposition: "ready"
            });
          }
        } catch (e) {
          items.push({ id: key, title, sessionId: key, memberIds: [], sizeBytes: 0, disposition: "blocked", ...safeError(e) });
        }
      }
      for (const [key, p] of this.previews) if (p.preview.expiresAt < Date.now()) this.previews.delete(key);
      if (this.previews.size >= 20) this.previews.delete(this.previews.keys().next().value);
      const preview = { id: randomUUID3(), action, items, expiresAt: Date.now() + 5 * 6e4 };
      this.previews.set(preview.id, { preview, groups, fingerprints });
      return preview;
    });
  }
  async execute(previewId, requestId2) {
    return this.serialize(async () => {
      await this.supported();
      checkRequestId(requestId2);
      const fingerprint = createHash3("sha256").update(`execute:${previewId}`).digest("hex");
      let saved = await this.requests.load(requestId2, fingerprint);
      if (saved?.complete) return saved.result;
      if (saved) {
        for (const op of await this.store.operations()) if (op.requestId === requestId2 && op.phase !== "pending") await this.recover(op);
        saved = await this.requests.load(requestId2, fingerprint);
      }
      let prepared;
      if (saved) prepared = { preview: saved.preview, groups: new Map(Object.entries(saved.groups)), fingerprints: new Map(Object.entries(saved.fingerprints)) };
      else {
        const candidate2 = this.previews.get(previewId);
        if (!candidate2 || candidate2.preview.expiresAt < Date.now()) throw new ArchiveError("preview-expired", "The preview expired. Refresh and review the targets again.");
        prepared = candidate2;
        this.previews.delete(previewId);
        saved = await this.requests.begin(requestId2, fingerprint, {
          preview: prepared.preview,
          groups: Object.fromEntries(prepared.groups),
          fingerprints: Object.fromEntries(prepared.fingerprints)
        });
      }
      for (const item of prepared.preview.items) {
        if (saved.result.items.some((previous) => previous.id === item.id)) continue;
        let outcome;
        if (item.disposition === "blocked") {
          outcome = { id: item.id, title: item.title, status: "skipped", ...item.code ? { code: item.code } : {}, ...item.message ? { message: item.message } : {} };
        } else try {
          const expected = prepared.groups.get(item.id);
          if (prepared.preview.action === "trash") {
            const fresh = await this.adapter.inspect(item.id);
            groupReady(fresh);
            if (groupFingerprint(fresh) !== prepared.fingerprints.get(item.id)) throw new ArchiveError("source-changed", MESSAGE["source-changed"]);
            outcome = await this.trashGroup(fresh, void 0, { requestId: requestId2, targetId: item.id }, true);
          } else {
            const current = await this.store.manifest(item.id);
            if (groupFingerprint(current.group) !== groupFingerprint(expected) || await this.store.entryFingerprint(item.id) !== prepared.fingerprints.get(item.id))
              throw new ArchiveError("source-changed", MESSAGE["source-changed"]);
            if (prepared.preview.action === "restore") {
              await this.restoreEntry(item.id, { requestId: requestId2, targetId: item.id }, prepared.fingerprints.get(item.id));
              outcome = { id: item.id, title: item.title, status: "restored" };
            } else {
              await this.purgeEntry(item.id, { requestId: requestId2, targetId: item.id }, prepared.fingerprints.get(item.id));
              outcome = { id: item.id, title: item.title, status: "purged" };
            }
          }
        } catch (e) {
          const interrupted = (await this.store.operations()).filter((op) => op.requestId === requestId2 && op.targetId === item.id && op.phase !== "pending");
          for (const op of interrupted) await this.recover(op);
          const recovered = (await this.requests.load(requestId2, fingerprint))?.result.items.find((previous) => previous.id === item.id);
          outcome = recovered ?? failure(item.id, item.title, e);
        }
        saved = await this.requests.record(requestId2, outcome);
        await this.finishTerminals(requestId2, item.id, outcome.status === "purged" ? item.id : void 0);
      }
      return this.requests.complete(requestId2);
    });
  }
  async trashGroup(group, pending, context, releaseIdle = false) {
    let lease = await this.adapter.acquire(group);
    if (lease.kind === "loaded" && releaseIdle && this.adapter.releaseIdle && await this.adapter.releaseIdle(group)) {
      const cold = await this.adapter.inspect(group.sessionId);
      groupReady(cold);
      if (groupFingerprint(cold) !== groupFingerprint(group)) throw new ArchiveError("source-changed", MESSAGE["source-changed"]);
      lease = await this.adapter.acquire(cold);
    }
    if (lease.kind === "busy") throw new ArchiveError("busy", MESSAGE.busy);
    if (lease.kind === "loaded") {
      if (!pending) await this.store.queue(group, "Waiting for DSH to release this idle session at the next start.", context);
      return { id: group.sessionId, title: group.title, status: "pending", code: "host-loaded", message: "Waiting for the next DSH start." };
    }
    let op;
    try {
      const fresh = await this.adapter.inspect(group.sessionId);
      groupReady(fresh);
      if (groupFingerprint(fresh) !== groupFingerprint(group)) throw new ArchiveError("source-changed", MESSAGE["source-changed"]);
      op = await this.store.prepareTrash(fresh, pending, context);
      await this.adapter.removeRegistry(fresh);
      await this.store.markDetached(op);
      await this.store.commitTrash(op);
      return { id: group.sessionId, title: group.title, status: "moved" };
    } catch (e) {
      op ??= (await this.store.operations()).find((o) => ["moving", "detached"].includes(o.phase) && o.group.sessionId === group.sessionId);
      if (op && !await this.store.hasEntry(op.entryId)) {
        try {
          await this.store.rollbackTrash(op);
          await this.adapter.restoreRegistry(op.group);
          await this.store.finish(op);
        } catch {
          throw new ArchiveError("recovery-required", MESSAGE["recovery-required"]);
        }
      }
      throw e;
    } finally {
      await lease.lease.release();
    }
  }
  async restoreEntry(entryId, context, expectedFingerprint) {
    let op;
    const manifest = await this.store.manifest(entryId);
    const held = await this.adapter.acquireLocated(manifest.group, await this.store.entryLocations(entryId));
    if (held.kind !== "acquired") throw new ArchiveError("busy", "Restore is waiting for the session write lock.");
    try {
      if (await this.store.entryFingerprint(entryId) !== expectedFingerprint) throw new ArchiveError("source-changed", MESSAGE["source-changed"]);
      op = await this.store.prepareRestore(entryId, context);
      await this.adapter.restoreRegistry(op.group);
      await this.store.markRestored(op);
      await this.store.commitRestore(op);
    } catch (e) {
      op ??= (await this.store.operations()).find((o) => ["restoring", "restored-metadata"].includes(o.phase) && o.entryId === entryId);
      if (op && op.phase === "restoring") {
        try {
          await this.store.rollbackRestore(op);
          await this.adapter.removeRegistry(op.group);
          await this.store.finish(op);
        } catch {
          throw new ArchiveError("recovery-required", MESSAGE["recovery-required"]);
        }
      }
      throw e;
    } finally {
      await held.lease.release();
    }
  }
  async purgeEntry(entryId, context, expectedFingerprint) {
    const manifest = await this.store.manifest(entryId);
    const held = await this.adapter.acquireLocated(manifest.group, await this.store.entryLocations(entryId));
    if (held.kind !== "acquired") throw new ArchiveError("busy", "Permanent deletion is waiting for the session write lock.");
    try {
      if (await this.store.entryFingerprint(entryId) !== expectedFingerprint) throw new ArchiveError("source-changed", MESSAGE["source-changed"]);
      await this.store.purge(entryId, context);
    } finally {
      await held.lease.release();
    }
  }
  async cancelPending(ids2, requestId2) {
    return this.serialize(async () => {
      await this.supported();
      checkRequestId(requestId2);
      validateIds(ids2);
      const fingerprint = createHash3("sha256").update(`cancel:${JSON.stringify(ids2)}`).digest("hex");
      let saved = await this.requests.load(requestId2, fingerprint);
      if (saved?.complete) return saved.result;
      saved ??= await this.requests.begin(requestId2, fingerprint, {
        preview: { id: requestId2, action: "trash", expiresAt: Date.now(), items: ids2.map((key) => ({ id: key, title: "", sessionId: key, memberIds: [], sizeBytes: 0, disposition: "ready" })) },
        groups: {},
        fingerprints: {}
      }, "cancel");
      for (const key of ids2) {
        if (saved.result.items.some((item) => item.id === key)) continue;
        const pending = (await this.store.operations()).filter((op) => op.phase === "pending" && op.group.sessionId === key);
        for (const op of pending) {
          if (op.requestId) await this.requests.record(op.requestId, { id: op.targetId, title: "", status: "cancelled" });
          await this.store.finish(op);
        }
        saved = await this.requests.record(requestId2, { id: key, title: "", status: pending.length ? "cancelled" : "skipped" });
      }
      return this.requests.complete(requestId2);
    });
  }
};

// src/host-routes.ts
var MAX_BODY_BYTES = 64 * 1024;
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value, keys2) {
  return Object.keys(value).length === keys2.length && keys2.every((key) => Object.hasOwn(value, key));
}
function token(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 100 && !value.includes("\0");
}
function ids(value) {
  return Array.isArray(value) && value.length > 0 && value.length <= 100 && value.every((id2) => typeof id2 === "string" && id2.length > 0 && id2.length <= 512 && !id2.includes("\0")) && new Set(value).size === value.length;
}
function parseApiRequest(value) {
  if (record(value)) {
    if (value.action === "list" && exactKeys(value, ["action"])) return { action: "list" };
    if (value.action === "updates" && exactKeys(value, ["action", "force"]) && typeof value.force === "boolean")
      return { action: "updates", force: value.force };
    if (value.action === "installUpdate" && exactKeys(value, ["action", "candidateId", "requestId"]) && typeof value.candidateId === "string" && value.candidateId.length > 0 && value.candidateId.length <= 512 && !value.candidateId.includes("\0") && token(value.requestId))
      return { action: "installUpdate", candidateId: value.candidateId, requestId: value.requestId };
    if (value.action === "storage") {
      if (exactKeys(value, ["action"])) return { action: "storage" };
      if (exactKeys(value, ["action", "workspaceId"]) && typeof value.workspaceId === "string" && value.workspaceId.length > 0 && value.workspaceId.length <= 512 && !value.workspaceId.includes("\0")) return { action: "storage", workspaceId: value.workspaceId };
    }
    if (value.action === "preview" && exactKeys(value, ["action", "operation", "ids"]) && typeof value.operation === "string" && ["trash", "restore", "purge"].includes(value.operation) && ids(value.ids)) {
      return { action: "preview", operation: value.operation, ids: value.ids };
    }
    if (value.action === "execute" && exactKeys(value, ["action", "previewId", "requestId"]) && token(value.previewId) && token(value.requestId)) {
      return { action: "execute", previewId: value.previewId, requestId: value.requestId };
    }
    if (value.action === "cancelPending" && exactKeys(value, ["action", "ids", "requestId"]) && ids(value.ids) && token(value.requestId)) {
      return { action: "cancelPending", ids: value.ids, requestId: value.requestId };
    }
  }
  throw new ArchiveError("invalid-request", "The request is not a supported archive operation.");
}
async function readRequest(request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > MAX_BODY_BYTES) throw new ArchiveError("request-too-large", "The request exceeds the size limit.");
  const reader = request.body?.getReader();
  if (!reader) throw new ArchiveError("invalid-request", "A JSON request body is required.");
  const chunks = [];
  let size = 0;
  try {
    for (; ; ) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new ArchiveError("request-too-large", "The request exceeds the size limit.");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ArchiveError("invalid-request", "The request body is not valid JSON.");
  }
}
function response(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
function errorStatus(code3) {
  if (code3 === "request-too-large") return 413;
  if (code3 === "invalid-request") return 400;
  if (code3 === "operation-failed") return 500;
  if (code3 === "unsupported-host") return 422;
  if (code3 === "update-unavailable") return 501;
  if (["store-busy", "scan-busy", "update-in-progress"].includes(code3)) return 423;
  if (code3 === "scan-closed" || code3 === "service-closed") return 503;
  if (["session-missing", "missing-session", "session-not-found", "workspace-not-found", "update-missing"].includes(code3)) return 404;
  return 409;
}
function createRequestHandler(api) {
  return async (request) => {
    if (request.method !== "POST") return new Response("method not allowed", { status: 405, headers: { allow: "POST" } });
    const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (contentType !== "application/json") return response({ ok: false, error: { code: "invalid-request", message: "Content-Type must be application/json." } }, 415);
    try {
      const input = parseApiRequest(await readRequest(request));
      let value;
      switch (input.action) {
        case "list":
          value = await api.list();
          break;
        case "preview":
          value = await api.preview(input.operation, input.ids);
          break;
        case "execute":
          value = await api.execute(input.previewId, input.requestId);
          break;
        case "cancelPending":
          value = await api.cancelPending(input.ids, input.requestId);
          break;
        case "storage":
          if (!api.storage) throw new ArchiveError("unsupported-host", "Storage inspection is unavailable in this host.");
          value = await api.storage(input.workspaceId, request.signal);
          break;
        case "updates":
          if (!api.updates) throw new ArchiveError("update-unavailable", "Update checking is unavailable on this host.");
          value = await api.updates(input.force);
          break;
        case "installUpdate":
          if (!api.installUpdate) throw new ArchiveError("update-unavailable", "Plugin updates are unavailable on this host.");
          value = await api.installUpdate(input.candidateId, input.requestId);
          break;
      }
      return response({ ok: true, value });
    } catch (error2) {
      const detail = safeError(error2);
      return response({ ok: false, error: detail }, errorStatus(detail.code));
    }
  };
}
function registerHostRoutes(ctx, api) {
  const connection = ctx.get?.("connection") ?? ctx.connection;
  if (!connection || typeof connection.fetch?.register !== "function") throw new ArchiveError("unsupported-host", "DSH authenticated Fetch routes are unavailable.");
  return connection.fetch.register({ path: API_PATH, methods: ["POST"], requestBody: "streaming", fetch: createRequestHandler(api) });
}

// src/storage-usage.ts
import { lstat as lstat5, opendir, realpath as realpath4 } from "node:fs/promises";
import { basename as basename3, join as join4, relative as relative3, resolve as resolve5, sep as sep3 } from "node:path";
import { setImmediate } from "node:timers/promises";

// src/storage-classification.ts
var versionControl = /* @__PURE__ */ new Set([".git", ".hg", ".svn"]);
var dependencies = /* @__PURE__ */ new Set(["node_modules", "vendor", ".venv", "venv", ".pnpm", ".yarn", "pods"]);
var build = /* @__PURE__ */ new Set(["dist", "build", ".next", ".nuxt", ".output", "target", "out", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".turbo", ".parcel-cache", "coverage"]);
var logs = /* @__PURE__ */ new Set(["log", "logs"]);
var extensions = [
  ["logs", /* @__PURE__ */ new Set(["log", "trace", "etl", "jsonl", "ndjson"])],
  ["media", /* @__PURE__ */ new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "ico", "bmp", "tif", "tiff", "heic", "heif", "mp3", "wav", "ogg", "m4a", "flac", "aac", "mid", "midi", "mp4", "mov", "mkv", "webm", "avi", "m4v", "mpeg", "mpg", "3gp"])],
  ["archives", /* @__PURE__ */ new Set(["zip", "tar", "gz", "zst", "zstd", "7z", "bz2", "xz", "rar", "br", "tgz", "whl", "jar", "war", "apk", "ipa", "dmg", "iso"])],
  ["code", /* @__PURE__ */ new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "vue", "svelte", "html", "htm", "css", "scss", "sass", "less", "py", "pyi", "ipynb", "lua", "rb", "go", "rs", "c", "h", "cc", "cpp", "cxx", "hpp", "cs", "java", "kt", "kts", "swift", "m", "mm", "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd", "sql", "r", "dart", "ex", "exs", "erl", "hs", "pl", "php", "toml", "yaml", "yml", "json", "xml", "ini", "cfg", "conf", "properties", "env", "lock"])],
  ["documents", /* @__PURE__ */ new Set(["pdf", "md", "mdx", "rst", "txt", "doc", "docx", "odt", "rtf", "xls", "xlsx", "csv", "tsv", "numbers", "ppt", "pptx", "odp", "key", "pages", "tex", "bib", "epub"])]
];
var codeNames = /* @__PURE__ */ new Set(["dockerfile", "makefile", "gnumakefile", "cmakelists.txt", "requirements.txt", "gemfile", "rakefile", "go.mod", "go.sum", ".gitignore", ".gitattributes", ".editorconfig", ".npmrc", ".env"]);
var documentNames = /* @__PURE__ */ new Set(["readme", "license", "licence", "notice", "changelog", "authors", "copying"]);
function classifyStorageFile(relativePath) {
  const parts = relativePath.toLowerCase().split(/[/\\]/).filter(Boolean);
  const name2 = parts.pop() ?? "";
  if (parts.some((part) => versionControl.has(part))) return "version-control";
  if (parts.some((part) => dependencies.has(part))) return "dependencies";
  if (parts.some((part) => build.has(part))) return "build";
  if (parts.some((part) => logs.has(part))) return "logs";
  if (/\.(?:log|trace|jsonl|ndjson)\.(?:gz|zst|zstd|xz|bz2)$/.test(name2)) return "logs";
  if (codeNames.has(name2) || name2.startsWith(".env.")) return "code";
  if (documentNames.has(name2)) return "documents";
  const dot = name2.lastIndexOf(".");
  const extension = dot < 0 ? "" : name2.slice(dot + 1);
  for (const [kind, names] of extensions) if (names.has(extension)) return kind;
  return "other";
}
var priority = {
  "version-control": 0,
  dependencies: 1,
  build: 2,
  logs: 3,
  media: 4,
  archives: 5,
  code: 6,
  documents: 7,
  other: 8
};
function preferredFileKind(first, second) {
  return priority[first] <= priority[second] ? first : second;
}

// src/storage-usage.ts
var counters = () => ({
  entries: 0,
  files: 0,
  directories: 0,
  symlinks: 0,
  unreadable: 0,
  changed: 0,
  unsupported: 0,
  crossDevice: 0,
  depthLimit: 0,
  excluded: 0,
  duplicateHardlinks: 0,
  duplicatePaths: 0,
  identityUnknown: 0
});
var code2 = (error2) => typeof error2 === "object" && error2 !== null && "code" in error2 ? String(error2.code) : "unreadable";
var signature = (s) => `${s.dev}:${s.ino}:${s.mode}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
var pathKey = (path) => process.platform === "win32" ? path.toLowerCase() : path;
function limit(value, fallback, minimum, maximum) {
  if (value === void 0) return fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError("Invalid storage scan limit.");
  return value;
}
async function scanStorage(roots, options = {}) {
  if (roots.length > 128 || new Set(roots.map((root) => root.id)).size !== roots.length || roots.some((root) => !root.id || root.readOnly !== true)) throw new TypeError("Storage roots must have unique IDs and be read-only.");
  const maxEntries = limit(options.maxEntries, 5e4, 1, 5e5);
  const maxDepth = limit(options.maxDepth, 32, 0, 64);
  const maxDurationMs = limit(options.maxDurationMs, 3e3, 0, 3e4);
  const largestLimit = limit(options.largestLimit, 20, 0, 100);
  const directoryLimit = limit(options.directoryLimit, 20, 0, 100);
  const yieldEvery = limit(options.yieldEvery, 64, 1, 1024);
  const clock = options.clock ?? (() => performance.now());
  const startedAt = Date.now();
  const tick = clock();
  const categories = roots.map((root) => ({
    id: root.id,
    kind: root.kind,
    ...root.label ? { label: root.label } : {},
    readOnly: true,
    status: "complete",
    fileBytes: null,
    referencedBytes: null,
    fileCount: 0,
    uniqueFileCount: 0,
    counters: counters(),
    issues: [],
    overlaps: [],
    largestFiles: [],
    directories: [],
    fileKinds: []
  }));
  const globalIdentities = /* @__PURE__ */ new Set();
  const globalPaths = /* @__PURE__ */ new Set();
  const measuredRoots = [];
  const excluded = (paths, path) => paths.some((skip) => samePath(skip, path) || isWithin(skip, path));
  let entries = 0;
  let fileCount = 0;
  let uniqueFileCount = 0;
  let fileBytes = 0;
  let referencedBytes = 0;
  let duplicateHardlinks = 0;
  let duplicatePaths = 0;
  let identityUnknown = 0;
  let yieldedAt = 0;
  const halted = () => options.signal?.aborted ? "cancelled" : clock() - tick >= maxDurationMs ? "time-budget" : entries >= maxEntries ? "entry-budget" : void 0;
  const issue = (category, problem, path) => {
    category.status = "partial";
    if (category.issues.length < 32 && !category.issues.some((item) => item.code === problem && item.relativePath === path))
      category.issues.push({ code: problem, ...path ? { relativePath: path } : {} });
  };
  const checkpoint = async (category) => {
    if (entries - yieldedAt >= yieldEvery) {
      yieldedAt = entries;
      try {
        options.onProgress?.({ entries, files: fileCount });
      } catch {
      }
      await setImmediate();
    }
    const reason = halted();
    if (reason) issue(category, reason);
    return !reason;
  };
  for (const [index, root] of roots.entries()) {
    const category = categories[index];
    if (!root.path) {
      category.status = "unavailable";
      category.issues.push({ code: root.unavailableReason ?? "root-unresolved" });
      continue;
    }
    if (!await checkpoint(category)) continue;
    const localIdentities = /* @__PURE__ */ new Set();
    const localPaths = /* @__PURE__ */ new Set();
    const classifiedFiles = /* @__PURE__ */ new Map();
    const fileKinds = /* @__PURE__ */ new Map();
    const folders = /* @__PURE__ */ new Map();
    const observations = [];
    const rootIsFile = root.file === true;
    let rootPath;
    let canonicalRoot;
    let rootDevice;
    let rootSignature;
    let excludes;
    try {
      assertLocalStoragePath(root.path);
      rootPath = resolve5(root.path);
      const before = await lstat5(rootPath, { bigint: true });
      if (before.isSymbolicLink() || (rootIsFile ? !before.isFile() : !before.isDirectory())) throw Object.assign(new Error("Unsafe root."), { code: "unsafe-root" });
      canonicalRoot = await realpath4(rootPath);
      await assertCanonicalStoragePath(rootPath, canonicalRoot);
      const after = await lstat5(rootPath, { bigint: true });
      if ((rootIsFile ? !after.isFile() : !after.isDirectory()) || after.isSymbolicLink() || signature(before) !== signature(after)) throw Object.assign(new Error("Changed root."), { code: "root-changed" });
      rootDevice = after.dev;
      rootSignature = signature(after);
      if ((root.excludePaths?.length ?? 0) > 128) throw Object.assign(new Error("Too many exclusions."), { code: "unsafe-exclusion" });
      excludes = (root.excludePaths ?? []).map((path) => {
        assertLocalStoragePath(path);
        const normalized = resolve5(path);
        if (rootIsFile || !isWithin(rootPath, normalized) && !isWithin(canonicalRoot, normalized))
          throw Object.assign(new Error("Exclusions must be proper descendants."), { code: "unsafe-exclusion" });
        return isWithin(rootPath, normalized) ? join4(canonicalRoot, relative3(rootPath, normalized)) : normalized;
      });
      category.fileBytes = 0;
      category.referencedBytes = 0;
      for (const known of measuredRoots) if (samePath(known.path, canonicalRoot) || isWithin(known.path, canonicalRoot) && !excluded(known.excludes, canonicalRoot) || isWithin(canonicalRoot, known.path) && !excluded(excludes, known.path)) {
        category.overlaps.push(known.id);
        categories.find((item) => item.id === known.id).overlaps.push(root.id);
      }
      measuredRoots.push({ id: root.id, path: canonicalRoot, excludes });
    } catch (error2) {
      category.status = code2(error2) === "ENOENT" ? "missing" : "unavailable";
      category.issues.push({ code: code2(error2) });
      continue;
    }
    const canonicalFor = (rel) => rootIsFile ? canonicalRoot : join4(canonicalRoot, rel === "." ? "" : rel);
    const inspect = async (path, rel) => {
      if (!await checkpoint(category)) return void 0;
      entries++;
      category.counters.entries++;
      try {
        const before = await lstat5(path, { bigint: true });
        if (samePath(path, rootPath) && signature(before) !== rootSignature) {
          category.counters.changed++;
          issue(category, "root-changed", rel);
          return void 0;
        }
        if (before.isSymbolicLink()) {
          category.counters.symlinks++;
          issue(category, "link-skipped", rel);
          return void 0;
        }
        if (!before.isFile() && !before.isDirectory()) {
          category.counters.unsupported++;
          issue(category, "special-file-skipped", rel);
          return void 0;
        }
        if (before.dev !== rootDevice) {
          category.counters.crossDevice++;
          issue(category, "cross-device-skipped", rel);
          return void 0;
        }
        const canonical = await realpath4(path);
        if (!samePath(canonical, canonicalFor(rel))) {
          category.counters.changed++;
          issue(category, "path-redirected", rel);
          return void 0;
        }
        await assertCanonicalStoragePath(path, canonical);
        const after = await lstat5(path, { bigint: true });
        if (after.isSymbolicLink() || signature(before) !== signature(after)) {
          category.counters.changed++;
          issue(category, "entry-changed", rel);
          return void 0;
        }
        observations.push({ path, relativePath: rel, signature: signature(after) });
        return after;
      } catch (error2) {
        if (code2(error2) === "ENOENT") category.counters.changed++;
        else category.counters.unreadable++;
        issue(category, code2(error2) === "ENOENT" ? "entry-disappeared" : "entry-unreadable", rel);
        return void 0;
      }
    };
    const add = (before, bytes) => {
      if (bytes > Number.MAX_SAFE_INTEGER - before) {
        issue(category, "aggregate-size-limit");
        return Number.MAX_SAFE_INTEGER;
      }
      return before + bytes;
    };
    const addFile = (rel, stat) => {
      if (stat.size < 0n || stat.size > BigInt(Number.MAX_SAFE_INTEGER)) {
        category.counters.unsupported++;
        issue(category, "size-unrepresentable", rel);
        return;
      }
      const bytes = Number(stat.size);
      const key = pathKey(canonicalFor(rel));
      const identity = stat.ino > 0n && stat.dev > 0n ? `${stat.dev}:${stat.ino}` : void 0;
      const kind = classifyStorageFile(rel);
      const classificationKey = identity ? `identity:${identity}` : `path:${key}`;
      category.fileCount++;
      category.counters.files++;
      fileCount++;
      category.referencedBytes = add(category.referencedBytes, bytes);
      referencedBytes = add(referencedBytes, bytes);
      const folder = rel.includes(sep3) ? rel.split(sep3)[0] : ".";
      const summary = folders.get(folder) ?? { relativePath: folder, fileBytes: 0, fileCount: 0 };
      summary.fileBytes = add(summary.fileBytes, bytes);
      summary.fileCount++;
      folders.set(folder, summary);
      if (localPaths.has(key)) category.counters.duplicatePaths++;
      else if (identity && localIdentities.has(identity)) category.counters.duplicateHardlinks++;
      else {
        const measuredBytes = add(category.fileBytes, bytes);
        const creditedBytes = measuredBytes - category.fileBytes;
        category.fileBytes = measuredBytes;
        category.uniqueFileCount++;
        const group = fileKinds.get(kind) ?? { kind, fileBytes: 0, fileCount: 0 };
        group.fileBytes += creditedBytes;
        group.fileCount++;
        fileKinds.set(kind, group);
        classifiedFiles.set(classificationKey, { kind, fileBytes: creditedBytes });
      }
      const classified = classifiedFiles.get(classificationKey);
      if (classified && preferredFileKind(classified.kind, kind) !== classified.kind) {
        const previous = fileKinds.get(classified.kind);
        previous.fileBytes -= classified.fileBytes;
        previous.fileCount--;
        if (previous.fileCount === 0) fileKinds.delete(classified.kind);
        const next = fileKinds.get(kind) ?? { kind, fileBytes: 0, fileCount: 0 };
        next.fileBytes += classified.fileBytes;
        next.fileCount++;
        fileKinds.set(kind, next);
        classified.kind = kind;
      }
      if (globalPaths.has(key)) duplicatePaths++;
      else if (identity && globalIdentities.has(identity)) duplicateHardlinks++;
      else {
        fileBytes = add(fileBytes, bytes);
        uniqueFileCount++;
      }
      if (!identity) {
        category.counters.identityUnknown++;
        identityUnknown++;
      }
      localPaths.add(key);
      globalPaths.add(key);
      if (identity) {
        localIdentities.add(identity);
        globalIdentities.add(identity);
      }
      category.largestFiles.push({ relativePath: rel.split(sep3).join("/"), sizeBytes: bytes, source: "unknown", kind });
      category.largestFiles.sort((a, b) => b.sizeBytes - a.sizeBytes || a.relativePath.localeCompare(b.relativePath));
      category.largestFiles.length = Math.min(category.largestFiles.length, largestLimit);
    };
    const walk = async (path, rel, depth) => {
      if (excluded(excludes, canonicalFor(rel))) {
        if (await checkpoint(category)) {
          entries++;
          category.counters.entries++;
          category.counters.excluded++;
        }
        return;
      }
      const stat = await inspect(path, rel);
      if (!stat) return;
      if (stat.isFile()) {
        addFile(rel, stat);
        return;
      }
      category.counters.directories++;
      if (depth > maxDepth) {
        category.counters.depthLimit++;
        issue(category, "depth-limit", rel);
        return;
      }
      let directory;
      try {
        directory = await opendir(path, { bufferSize: 32 });
        const current = await lstat5(path, { bigint: true });
        const canonical = await realpath4(path);
        if (current.isSymbolicLink() || signature(current) !== signature(stat) || !samePath(canonical, canonicalFor(rel))) {
          category.counters.changed++;
          issue(category, "directory-changed", rel);
          return;
        }
        for (; ; ) {
          if (!await checkpoint(category)) break;
          const child = await directory.read();
          if (!child) break;
          await walk(join4(path, child.name), rel === "." ? child.name : join4(rel, child.name), depth + 1);
        }
      } catch (error2) {
        category.counters.unreadable++;
        issue(category, "directory-unreadable", rel);
      } finally {
        if (directory) await directory.close().catch(() => {
        });
      }
    };
    await walk(rootPath, rootIsFile ? basename3(canonicalRoot) : ".", 0);
    for (const observation of observations) {
      if (!await checkpoint(category)) break;
      try {
        const current = await lstat5(observation.path, { bigint: true });
        const canonical = await realpath4(observation.path);
        if (current.isSymbolicLink() || signature(current) !== observation.signature || !samePath(canonical, canonicalFor(observation.relativePath))) {
          category.counters.changed++;
          issue(category, "entry-changed", observation.relativePath);
        }
      } catch {
        category.counters.changed++;
        issue(category, "entry-disappeared", observation.relativePath);
      }
    }
    category.directories = [...folders.values()].sort((a, b) => b.fileBytes - a.fileBytes || a.relativePath.localeCompare(b.relativePath)).slice(0, directoryLimit);
    category.fileKinds = [...fileKinds.values()].sort((a, b) => b.fileBytes - a.fileBytes || a.kind.localeCompare(b.kind));
  }
  const finishedAt = Date.now();
  return {
    metric: "logical-file-bytes",
    startedAt,
    finishedAt,
    durationMs: Math.max(0, clock() - tick),
    complete: categories.every((category) => category.status === "complete"),
    fileBytes,
    referencedBytes,
    fileCount,
    uniqueFileCount,
    duplicateHardlinks,
    duplicatePaths,
    identityUnknown,
    categories
  };
}

// src/storage-inspector.ts
var StorageInspector = class {
  constructor(resolver, options = {}) {
    this.resolver = resolver;
    this.options = options;
  }
  active;
  closed = false;
  workspaces() {
    try {
      return this.resolver.workspaces();
    } catch {
      return [];
    }
  }
  scan(workspaceId, signal) {
    if (this.closed) return Promise.reject(new ArchiveError("scan-closed", "Storage inspection is closed. Reload the plugin and try again."));
    if (this.active) return Promise.reject(new ArchiveError("scan-busy", "A storage scan is already running. Wait for it to finish or cancel it."));
    const controller = new AbortController();
    const cancel = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener("abort", cancel, { once: true });
    const checkCancelled = () => {
      if (controller.signal.aborted) throw new ArchiveError("scan-cancelled", "The storage scan was cancelled.");
    };
    const done = (async () => {
      checkCancelled();
      const roots = await this.resolver.sources(workspaceId);
      checkCancelled();
      const usage = await (this.options.scan ?? scanStorage)(roots, { signal: controller.signal, maxDurationMs: 5e3, maxEntries: 5e4 });
      checkCancelled();
      if (workspaceId !== void 0) {
        let current;
        try {
          current = await this.resolver.sources(workspaceId);
        } catch {
          throw new ArchiveError("workspace-changed", "The selected workspace changed. Select it again and rescan.");
        }
        checkCancelled();
        if (roots.length !== 1 || current.length !== 1 || roots[0]?.id !== current[0]?.id || roots[0]?.path !== current[0]?.path || !sameExclusions(roots[0]?.excludePaths ?? [], current[0]?.excludePaths ?? []))
          throw new ArchiveError("workspace-changed", "The selected workspace changed. Select it again and rescan.");
      }
      return {
        ...usage,
        scope: workspaceId === void 0 ? "host" : "workspace",
        workspaces: this.workspaces(),
        ...workspaceId === void 0 ? {} : { workspaceId }
      };
    })();
    this.active = { controller, done };
    const finish = () => {
      signal?.removeEventListener("abort", cancel);
      if (this.active?.done === done) this.active = void 0;
    };
    void done.then(finish, finish);
    return done;
  }
  async close() {
    this.closed = true;
    const active = this.active;
    if (!active) return;
    active.controller.abort();
    await active.done.catch(() => {
    });
  }
};
function sameExclusions(before, after) {
  const expected = new Set(before);
  const received = new Set(after);
  return expected.size === received.size && [...expected].every((path) => received.has(path));
}
function wrapArchiveApi(api, inspector) {
  return {
    list: async () => ({ ...await api.list(), storageWorkspaces: inspector.workspaces() }),
    preview: (action, ids2) => api.preview(action, ids2),
    execute: (previewId, requestId2) => api.execute(previewId, requestId2),
    cancelPending: (ids2, requestId2) => api.cancelPending(ids2, requestId2),
    storage: (workspaceId, signal) => inspector.scan(workspaceId, signal)
  };
}

// src/version.ts
import { createRequire as createRequire2 } from "node:module";
var PLUGIN_VERSION = createRequire2(import.meta.url)("../package.json").version;

// src/update-service.ts
import { createHash as createHash4, randomUUID as randomUUID4 } from "node:crypto";
import { constants as constants3 } from "node:fs";
import { link, lstat as lstat6, mkdir as mkdir3, open as open5, readdir as readdir4, rename as rename3, unlink as unlink3 } from "node:fs/promises";
import { dirname as dirname3, join as join5 } from "node:path";

// src/update-source-types.ts
var UpdateRateLimitError = class extends ArchiveError {
  constructor(retryAt) {
    super("update-rate-limited", "GitHub rate-limited update checks. Try again later.");
    this.retryAt = retryAt;
  }
};

// src/update-service.ts
var DAY = 24 * 60 * 6e4;
var RETRY = 60 * 6e4;
var UUID3 = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
var VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
var record2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var bounded = (value, maximum) => typeof value === "string" && value.length > 0 && value.length <= maximum && !value.includes("\0");
var errorCode = (error2) => error2 instanceof ArchiveError && /^update-[a-z-]+$/.test(error2.code) ? error2.code : "update-failed";
function candidate(value) {
  return record2(value) && bounded(value.id, 512) && typeof value.version === "string" && VERSION.test(value.version) && bounded(value.requiredDshVersion, 100) && bounded(value.publishedAt, 100) && value.releaseUrl === `https://github.com/QwQBiG/dsh-archive-delete/releases/tag/v${value.version}` && typeof value.notes === "string" && value.notes.length <= 64e3 && Number.isSafeInteger(value.assetBytes) && Number(value.assetBytes) > 0 && Number(value.assetBytes) <= 16 * 1024 * 1024;
}
var UpdateStore = class {
  constructor(root, profileId) {
    this.root = root;
    this.profileKey = createHash4("sha256").update(profileId).digest("hex");
  }
  profileKey;
  async initialize() {
    await assertPrivateDirectory(this.root);
    for (const path of [this.area(), this.packages()]) {
      let created = false;
      try {
        await mkdir3(path, { mode: 448 });
        created = true;
      } catch (error2) {
        if (error2.code !== "EEXIST") throw error2;
      }
      await assertPrivateDirectory(path);
      if (created) await syncDirectory(dirname3(path));
      for (const name2 of await readdir4(path)) if (/^\.update-[a-f\d-]{36}\.tmp$/.test(name2)) {
        const temporary = join5(path, name2);
        const st = await lstat6(temporary);
        if (!st.isFile() || st.isSymbolicLink()) throw new ArchiveError("update-state-unsafe", "A temporary update file is unsafe.");
        await unlink3(temporary);
      }
    }
  }
  area() {
    return join5(this.root, "updates");
  }
  packages() {
    return join5(this.area(), "packages");
  }
  async read(name2) {
    await assertPrivateDirectory(this.area());
    try {
      return await readBoundedJson(join5(this.area(), `${this.profileKey}.${name2}`), 128 * 1024);
    } catch (error2) {
      if (error2.code === "ENOENT") return void 0;
      throw error2;
    }
  }
  async write(name2, value) {
    await assertPrivateDirectory(this.root);
    await assertPrivateDirectory(this.area());
    const target = join5(this.area(), `${this.profileKey}.${name2}`);
    const temporary = join5(this.area(), `.update-${randomUUID4()}.tmp`);
    try {
      try {
        const before = await lstat6(target);
        if (!before.isFile() || before.isSymbolicLink()) throw new ArchiveError("update-state-unsafe", "Update metadata is unsafe.");
      } catch (error2) {
        if (error2.code !== "ENOENT") throw error2;
      }
      const handle = await open5(temporary, constants3.O_CREAT | constants3.O_EXCL | constants3.O_WRONLY | (constants3.O_NOFOLLOW ?? 0), 384);
      try {
        await handle.writeFile(JSON.stringify(value));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename3(temporary, target);
      await syncDirectory(this.area());
    } finally {
      await unlink3(temporary).catch(() => {
      });
    }
  }
  async package(version, digest, bytes) {
    if (!VERSION.test(version) || !/^[a-f\d]{64}$/.test(digest) || bytes.length > 16 * 1024 * 1024 || createHash4("sha256").update(bytes).digest("hex") !== digest) throw new ArchiveError("update-integrity", "The release package failed its checksum.");
    await assertPrivateDirectory(this.root);
    await assertPrivateDirectory(this.area());
    await assertPrivateDirectory(this.packages());
    const target = join5(this.packages(), `${version}-${digest}.tgz`);
    const verifyExisting = async () => {
      const before = await lstat6(target, { bigint: true });
      if (!before.isFile() || before.isSymbolicLink() || before.size !== BigInt(bytes.length)) throw new ArchiveError("update-state-unsafe", "A cached update package is unsafe.");
      const handle = await open5(target, constants3.O_RDONLY | (constants3.O_NOFOLLOW ?? 0));
      try {
        const held = await handle.stat({ bigint: true });
        const data = await handle.readFile();
        const after = await lstat6(target, { bigint: true });
        if (held.dev !== before.dev || held.ino !== before.ino || held.size !== before.size || held.mtimeNs !== before.mtimeNs || after.dev !== before.dev || after.ino !== before.ino || after.isSymbolicLink() || createHash4("sha256").update(data).digest("hex") !== digest) throw new ArchiveError("update-integrity", "The cached release package changed.");
      } finally {
        await handle.close();
      }
    };
    try {
      await verifyExisting();
      return target;
    } catch (error2) {
      if (error2.code !== "ENOENT") throw error2;
    }
    const temporary = join5(this.packages(), `.update-${randomUUID4()}.tmp`);
    try {
      const handle = await open5(temporary, constants3.O_CREAT | constants3.O_EXCL | constants3.O_WRONLY | (constants3.O_NOFOLLOW ?? 0), 384);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await link(temporary, target);
      } catch (error2) {
        if (error2.code !== "EEXIST") throw error2;
        await verifyExisting();
      }
    } finally {
      await unlink3(temporary).catch(() => {
      });
    }
    await syncDirectory(this.packages());
    await verifyExisting();
    return target;
  }
};
var UpdateService = class {
  constructor(options) {
    this.options = options;
    this.store = new UpdateStore(options.root, options.host.profileId);
    this.now = options.now ?? Date.now;
    this.installedVersion = options.host.loadedVersion;
  }
  store;
  now;
  cache;
  checkPromise;
  checkAbort;
  installAbort;
  installation;
  installPromise;
  activeRequest;
  interval;
  closed = false;
  installedVersion;
  async initialize() {
    await this.store.initialize();
    this.installedVersion = (await this.options.host.installed()).version;
    const cached = await this.store.read("check.json");
    if (record2(cached) && cached.schema === 1 && cached.currentVersion === this.options.host.loadedVersion && cached.hostVersion === this.options.host.hostVersion && typeof cached.checkedAt === "number" && Number.isSafeInteger(cached.checkedAt) && cached.checkedAt >= 0 && cached.checkedAt <= this.now() && typeof cached.nextCheckAt === "number" && Number.isSafeInteger(cached.nextCheckAt) && cached.nextCheckAt >= cached.checkedAt && cached.nextCheckAt <= cached.checkedAt + 7 * DAY && record2(cached.check) && ["current", "available", "incompatible", "error"].includes(String(cached.check.availability)) && (cached.check.code === void 0 || /^update-[a-z-]+$/.test(String(cached.check.code))) && (cached.check.candidate === void 0 || candidate(cached.check.candidate))) this.cache = cached;
    const saved = await this.store.read("installation.json");
    if (saved !== void 0) {
      if (!record2(saved) || !UUID3.test(String(saved.requestId)) || !bounded(saved.candidateId, 512) || !VERSION.test(String(saved.version)) || typeof saved.startedAt !== "number" || !Number.isSafeInteger(saved.startedAt) || saved.startedAt < 0 || !["installing", "installed", "restart-required", "failed", "interrupted", "unknown"].includes(String(saved.status)))
        throw new ArchiveError("update-state-unsafe", "The saved update operation is invalid.");
      this.installation = saved;
      if (["installing", "installed", "restart-required", "unknown"].includes(this.installation.status)) {
        this.installation = { ...this.installation, status: this.installedVersion === this.installation.version ? this.options.host.loadedVersion === this.installedVersion ? "installed" : "restart-required" : this.options.host.loadedVersion === this.installedVersion ? "interrupted" : "unknown" };
        if (this.installation.status === "installed") delete this.installation.code;
        await this.store.write("installation.json", this.installation);
      }
    }
    if (this.installedVersion !== this.options.host.loadedVersion || ["restart-required", "unknown"].includes(this.installation?.status ?? "")) {
      const release2 = await this.options.beginUpdate();
      release2(true);
    }
  }
  start() {
    if (this.closed || !this.options.host.canInstall || this.interval) return;
    void this.info().catch(() => {
    });
    this.interval = setInterval(() => {
      void this.info().catch(() => {
      });
    }, RETRY);
    this.interval.unref();
  }
  overview() {
    return {
      currentVersion: this.options.host.loadedVersion,
      installedVersion: this.installedVersion,
      hostVersion: this.options.host.hostVersion,
      availability: this.cache?.check.availability ?? "unknown",
      canInstall: this.options.host.canInstall && !this.closed,
      ...this.cache ? {
        checkedAt: this.cache.checkedAt,
        nextCheckAt: this.cache.nextCheckAt,
        ...this.cache.check.candidate ? { candidate: this.cache.check.candidate } : {},
        ...this.cache.check.code ? { code: this.cache.check.code } : {}
      } : {},
      ...this.installation ? { installation: {
        requestId: this.installation.requestId,
        version: this.installation.version,
        status: this.installation.status,
        ...this.installation.code ? { code: this.installation.code } : {}
      } } : {}
    };
  }
  async info(force = false) {
    if (this.closed) throw new ArchiveError("update-stopping", "The plugin is stopping.");
    if (!this.installPromise) await this.reconcileInstallation();
    if (this.installPromise || this.installedVersion !== this.options.host.loadedVersion) return this.overview();
    const due = !this.cache || this.now() >= this.cache.nextCheckAt;
    const rateLimited = this.cache?.check.code === "update-rate-limited" && this.now() < this.cache.nextCheckAt;
    const manual = force && !rateLimited && (!this.cache || this.now() - this.cache.checkedAt >= 6e4);
    if (!this.checkPromise && (due || manual)) {
      const abort = new AbortController();
      this.checkAbort = abort;
      const checking = (async () => {
        const checkedAt = this.now();
        try {
          const check = await this.options.source.check(abort.signal);
          this.cache = {
            schema: 1,
            currentVersion: this.options.host.loadedVersion,
            hostVersion: this.options.host.hostVersion,
            checkedAt,
            nextCheckAt: checkedAt + DAY,
            check: {
              availability: check.availability,
              ...check.candidate ? { candidate: check.candidate } : {},
              ...check.code ? { code: check.code } : {}
            }
          };
          await this.store.write("check.json", this.cache);
        } catch (error2) {
          if (abort.signal.aborted && this.closed) return;
          this.cache = {
            schema: 1,
            currentVersion: this.options.host.loadedVersion,
            hostVersion: this.options.host.hostVersion,
            checkedAt,
            nextCheckAt: Math.max(checkedAt + RETRY, error2 instanceof UpdateRateLimitError ? Math.min(checkedAt + 7 * DAY, error2.retryAt) : 0),
            check: {
              availability: "error",
              code: errorCode(error2),
              ...this.cache?.check.candidate ? { candidate: this.cache.check.candidate } : {}
            }
          };
          await this.store.write("check.json", this.cache).catch(() => {
          });
        }
      })();
      this.checkPromise = checking;
      void checking.finally(() => {
        if (this.checkPromise === checking) {
          this.checkPromise = void 0;
          this.checkAbort = void 0;
        }
      }).catch(() => {
      });
    }
    await this.checkPromise;
    return this.overview();
  }
  async install(candidateId, requestId2) {
    if (!UUID3.test(requestId2) || !bounded(candidateId, 512)) throw new ArchiveError("invalid-request", "A valid update confirmation is required.");
    if (this.activeRequest?.requestId === requestId2) {
      if (this.activeRequest.candidateId !== candidateId) throw new ArchiveError("update-request-conflict", "This request belongs to a different update.");
      return this.installPromise;
    }
    if (this.installation?.requestId === requestId2) {
      if (this.installation.candidateId !== candidateId) throw new ArchiveError("update-request-conflict", "This request belongs to a different update.");
      if (this.installPromise) return this.installPromise;
      if (this.closed) throw new ArchiveError("update-stopping", "The plugin is stopping.");
      await this.reconcileInstallation();
      return this.overview();
    }
    if (this.closed || !this.options.host.canInstall) throw new ArchiveError("update-unavailable", "The native plugin manager is unavailable.");
    if (this.installPromise || this.installedVersion !== this.options.host.loadedVersion || ["installing", "restart-required", "unknown"].includes(this.installation?.status ?? "")) throw new ArchiveError("update-in-progress", "An update is already running or waiting for a restart.");
    if (this.cache?.check.availability !== "available" || this.cache.check.candidate?.id !== candidateId)
      throw new ArchiveError("update-changed", "Check updates again and review the current release.");
    const reviewed = this.cache.check.candidate;
    this.activeRequest = { requestId: requestId2, candidateId };
    const task = this.runInstall(reviewed, candidateId, requestId2);
    this.installPromise = task;
    void task.finally(() => {
      if (this.installPromise === task) {
        this.installPromise = void 0;
        this.activeRequest = void 0;
      }
    }).catch(() => {
    });
    return task;
  }
  /** A lost manager reply never authorizes a second installation. Re-read the
   * native profile to settle an already installed target; an old or unreadable
   * target alone cannot prove that a delegated package operation has stopped. */
  async reconcileInstallation() {
    const saved = this.installation;
    if (!saved || !["installing", "unknown", "restart-required"].includes(saved.status)) return;
    let installed;
    try {
      installed = (await this.options.host.installed()).version;
    } catch {
      return;
    }
    this.installedVersion = installed;
    if (installed !== saved.version || this.installation !== saved || this.installPromise) return;
    const status = installed === this.options.host.loadedVersion ? "installed" : "restart-required";
    if (saved.status === status && saved.code === void 0) return;
    this.installation = { ...saved, status };
    delete this.installation.code;
    await this.store.write("installation.json", this.installation);
  }
  async runInstall(reviewed, candidateId, requestId2) {
    let release2;
    let managerCalled = false;
    const abort = new AbortController();
    this.installAbort = abort;
    const budget = setTimeout(() => abort.abort(new ArchiveError("update-timeout", "Update verification exceeded its time budget.")), 3e4);
    const checkStopped = () => {
      if (this.closed) throw new ArchiveError("update-stopping", "The plugin stopped before installation.");
      if (abort.signal.aborted) throw new ArchiveError("update-timeout", "Update verification exceeded its time budget.");
    };
    try {
      const checked = await this.options.source.check(abort.signal);
      checkStopped();
      if (checked.availability !== "available" || checked.pinned?.candidate.id !== candidateId || checked.candidate?.version !== reviewed.version)
        throw new ArchiveError("update-changed", "The release changed. Review a fresh update before installing.");
      await this.options.source.revalidate(checked.pinned, abort.signal);
      checkStopped();
      const bytes = await this.options.source.download(checked.pinned, abort.signal);
      checkStopped();
      const packagePath = await this.store.package(reviewed.version, checked.pinned.sha256, bytes);
      const installed = await this.options.host.installed();
      if (installed.version !== this.options.host.loadedVersion) throw new ArchiveError("update-restart-required", "A different version is already installed. Restart DSH before continuing.");
      if (this.closed) throw new ArchiveError("update-stopping", "The plugin stopped before installation.");
      release2 = await this.options.beginUpdate();
      if (this.closed) throw new ArchiveError("update-stopping", "The plugin stopped before installation.");
      this.installation = { requestId: requestId2, candidateId, version: reviewed.version, status: "installing", startedAt: this.now() };
      await this.store.write("installation.json", this.installation);
      if (this.closed) throw new ArchiveError("update-stopping", "The plugin stopped before installation.");
      checkStopped();
      clearTimeout(budget);
      managerCalled = true;
      const result2 = await this.options.host.install(packagePath, reviewed.version, requestId2);
      this.installedVersion = (await this.options.host.installed()).version;
      const status = this.installedVersion === reviewed.version ? result2.status === "installed" ? "installed" : result2.status === "restart-required" ? "restart-required" : "unknown" : result2.status === "failed" && this.installedVersion === this.options.host.loadedVersion ? "failed" : "unknown";
      this.installation = { ...this.installation, status, ...result2.code ? { code: result2.code } : {} };
      await this.store.write("installation.json", this.installation);
      release2(status === "restart-required" || status === "unknown" || this.installedVersion !== this.options.host.loadedVersion);
      release2 = void 0;
      return this.overview();
    } catch (error2) {
      let changed2 = managerCalled;
      try {
        this.installedVersion = (await this.options.host.installed()).version;
        changed2 ||= this.installedVersion !== this.options.host.loadedVersion;
      } catch {
      }
      if (this.installation?.requestId === requestId2 || managerCalled) {
        this.installation = {
          requestId: requestId2,
          candidateId,
          version: reviewed.version,
          startedAt: this.installation?.startedAt ?? this.now(),
          status: changed2 ? "unknown" : "failed",
          code: errorCode(error2)
        };
        await this.store.write("installation.json", this.installation);
      }
      release2?.(changed2);
      release2 = void 0;
      if (managerCalled) return this.overview();
      throw error2;
    } finally {
      clearTimeout(budget);
      if (this.installAbort === abort) this.installAbort = void 0;
      release2?.(true);
    }
  }
  async close() {
    this.closed = true;
    if (this.interval) clearInterval(this.interval);
    this.checkAbort?.abort();
    await this.checkPromise?.catch(() => {
    });
    this.installAbort?.abort();
  }
};

// src/update-host.ts
import { createHash as createHash6 } from "node:crypto";
import { constants as constants5 } from "node:fs";
import { createRequire as createRequire4 } from "node:module";
import { lstat as lstat8, open as open6, realpath as realpath5 } from "node:fs/promises";
import { basename as basename4, dirname as dirname4, isAbsolute as isAbsolute3, join as join6, resolve as resolve7 } from "node:path";
import { pathToFileURL as pathToFileURL2 } from "node:url";

// src/host-manifest.ts
import { constants as constants4 } from "node:fs";
import { lstat as lstat7, readFile as readFile2 } from "node:fs/promises";
import { createRequire as createRequire3 } from "node:module";
import { resolve as resolve6 } from "node:path";
var MAX_ARCHIVE_BYTES = 1024n * 1024n * 1024n;
var signature2 = (stat) => `${stat.dev}:${stat.ino}:${stat.mode}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
var entrySignature = (stat) => `${stat.mode}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
function invalid() {
  return new ArchiveError("corrupt-state", "The installed host manifest is invalid or too large.");
}
function changed() {
  return new ArchiveError("unsafe-path", "The installed host archive or manifest changed while reading.");
}
function archivePath(path) {
  if (!process.versions.electron) return void 0;
  const match = /\.asar(?=[/\\])/i.exec(path);
  return match ? path.slice(0, match.index + ".asar".length) : void 0;
}
function plainArchive(stat) {
  return stat.isFile() && !stat.isSymbolicLink() && stat.size > 0n && stat.size <= MAX_ARCHIVE_BYTES;
}
function plainEntry(stat, limit2) {
  return stat.isFile() && !stat.isSymbolicLink() && stat.size >= 0n && stat.size <= BigInt(limit2);
}
async function readHostManifest(path, limit2 = 1024 * 1024) {
  if (!Number.isSafeInteger(limit2) || limit2 <= 0 || limit2 > 8 * 1024 * 1024) throw new RangeError("Invalid host manifest size limit.");
  const normalized = resolve6(path);
  const archive = archivePath(normalized);
  if (!archive) return readBoundedJson(path, limit2);
  const physical = createRequire3(import.meta.url)("original-fs").promises;
  const before = await physical.lstat(archive, { bigint: true });
  if (!plainArchive(before)) throw invalid();
  const handle = await physical.open(archive, constants4.O_RDONLY | (constants4.O_NOFOLLOW ?? 0));
  try {
    const held = await handle.stat({ bigint: true });
    const current = await physical.lstat(archive, { bigint: true });
    if (!plainArchive(held) || !plainArchive(current) || signature2(before) !== signature2(held) || signature2(before) !== signature2(current)) throw changed();
    const entry = await lstat7(normalized, { bigint: true });
    if (!plainEntry(entry, limit2)) throw invalid();
    const bytes = await readFile2(normalized);
    const afterEntry = await lstat7(normalized, { bigint: true });
    const afterArchive = await physical.lstat(archive, { bigint: true });
    const afterHeld = await handle.stat({ bigint: true });
    if (!plainEntry(afterEntry, limit2) || bytes.byteLength > limit2 || BigInt(bytes.byteLength) !== entry.size || entrySignature(entry) !== entrySignature(afterEntry) || !plainArchive(afterArchive) || !plainArchive(afterHeld) || signature2(before) !== signature2(afterArchive) || signature2(before) !== signature2(afterHeld)) throw changed();
    try {
      return JSON.parse(bytes.toString("utf8"));
    } catch {
      throw invalid();
    }
  } finally {
    await handle.close();
  }
}

// src/update-source.ts
import { createHash as createHash5 } from "node:crypto";
import { gunzip } from "node:zlib";
var REPOSITORY = "QwQBiG/dsh-archive-delete";
var API = `https://api.github.com/repos/${REPOSITORY}/releases`;
var WEB = `https://github.com/${REPOSITORY}/releases`;
var MAX = { releasesBytes: 1024 * 1024, metadataBytes: 32 * 1024, assetBytes: 16 * 1024 * 1024, expandedBytes: 64 * 1024 * 1024, tarEntries: 4096 };
var STABLE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
var SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
var PEERS = /* @__PURE__ */ new Set(["@deepseek-ai/cordis", "@deepseek-ai/dsh-app-boot", "@deepseek-ai/dsh-home-paths", "@deepseek-ai/node-addon-system", "react"]);
var error = (code3, message) => new ArchiveError(code3, message);
var invalid2 = () => error("update-metadata-invalid", "GitHub update metadata is invalid.");
var packageInvalid = () => error("update-package-invalid", "The release is not a supported prebuilt plugin package.");
var object3 = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
var keys = (value, names) => Object.keys(value).length === names.length && names.every((name2) => Object.hasOwn(value, name2));
var integer = (value) => Number.isSafeInteger(value) && Number(value) > 0;
function stable(value) {
  if (typeof value !== "string" || value.length > 64 || !STABLE.test(value)) return;
  const parts = value.split(".").map(Number);
  return parts.every(Number.isSafeInteger) ? parts : void 0;
}
function exactVersion(value) {
  return typeof value === "string" && value.length <= 100 && SEMVER.test(value) && value.split(/[-+]/, 1)[0].split(".").every((part) => Number.isSafeInteger(Number(part)));
}
function supportedPackageDshVersions(manifest) {
  if (!object3(manifest) || !object3(manifest.engines) || !exactVersion(manifest.engines.dsh)) throw packageInvalid();
  const primary = manifest.engines.dsh;
  if (manifest.dshArchiveDelete === void 0) return [primary];
  const declared = object3(manifest.dshArchiveDelete) ? manifest.dshArchiveDelete.supportedDshVersions : void 0;
  if (!Array.isArray(declared) || declared.length < 1 || declared.length > 8 || !declared.every(exactVersion) || new Set(declared).size !== declared.length || !declared.includes(primary)) throw packageInvalid();
  return [...declared];
}
function compare(left, right) {
  const a = stable(left);
  const b = stable(right);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}
function json(bytes) {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw invalid2();
  }
}
function release(value) {
  if (!object3(value) || value.draft !== false || value.prerelease !== false || typeof value.tag_name !== "string") return;
  const version = value.tag_name.replace(/^v/, "");
  if (!stable(version)) return;
  if (value.tag_name !== `v${version}`) throw invalid2();
  if (!integer(value.id) || typeof value.published_at !== "string" || value.published_at.length > 40 || !Number.isFinite(Date.parse(value.published_at)) || value.html_url !== `${WEB}/tag/${value.tag_name}` || !Array.isArray(value.assets) || value.assets.length > 100 || !value.assets.every(object3)) throw invalid2();
  return {
    id: value.id,
    tag: value.tag_name,
    version,
    publishedAt: value.published_at,
    notes: typeof value.body === "string" ? value.body.slice(0, 6e3) : "",
    assets: value.assets
  };
}
function metadata(value, version, assetName) {
  if (!object3(value) || !keys(value, ["schema", "packageName", "version", "requiredDshVersion", "platforms", "asset"]) || value.schema !== 1 || value.packageName !== PACKAGE_NAME || value.version !== version || typeof value.requiredDshVersion !== "string" || value.requiredDshVersion.length > 100 || !SEMVER.test(value.requiredDshVersion) || !Array.isArray(value.platforms) || value.platforms.length < 1 || value.platforms.length > 2 || new Set(value.platforms).size !== value.platforms.length || value.platforms.some((platform) => platform !== "darwin" && platform !== "win32") || !object3(value.asset) || !keys(value.asset, ["name", "bytes", "sha256"]) || value.asset.name !== assetName || !integer(value.asset.bytes) || value.asset.bytes > MAX.assetBytes || typeof value.asset.sha256 !== "string" || !/^[a-f\d]{64}$/.test(value.asset.sha256)) throw invalid2();
  return value;
}
function samePin(left, right) {
  return left.assetUrl === right.assetUrl && left.sha256 === right.sha256 && JSON.stringify(left.candidate) === JSON.stringify(right.candidate);
}
function createGithubUpdateSource(options) {
  if (!stable(options.currentVersion)) throw new TypeError("The current plugin version must be stable SemVer.");
  if (!exactVersion(options.hostVersion)) throw new TypeError("The host version must be exact SemVer.");
  const limits = { ...MAX };
  for (const name2 of Object.keys(MAX)) if (options.limits?.[name2] !== void 0) {
    const value = options.limits[name2];
    if (!integer(value) || value > MAX[name2]) throw new RangeError("Invalid update response limit.");
    limits[name2] = value;
  }
  const timeoutMs = options.timeoutMs ?? 15e3;
  if (!integer(timeoutMs) || timeoutMs > 3e4) throw new RangeError("Invalid update request timeout.");
  const fetcher = options.fetch ?? globalThis.fetch;
  const known = /* @__PURE__ */ new Map();
  let retryAt = 0;
  const withBudget = async (signal, operation) => {
    const controller = new AbortController();
    const cancel = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = setTimeout(() => controller.abort(error("update-timeout", "The GitHub update operation timed out.")), timeoutMs);
    try {
      return await operation(controller.signal);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  };
  async function read(url, maximum, signal) {
    if (Date.now() < retryAt) throw new UpdateRateLimitError(retryAt);
    const controller = new AbortController();
    let timedOut = false;
    let reader;
    const cancelled = () => error(timedOut ? "update-timeout" : "update-cancelled", timedOut ? "The GitHub update request timed out." : "The update request was cancelled.");
    const cancel = () => {
      timedOut = signal?.reason instanceof ArchiveError && signal.reason.code === "update-timeout";
      controller.abort();
    };
    const abort = new Promise((_, reject) => controller.signal.addEventListener("abort", () => reject(cancelled()), { once: true }));
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const execute = async () => {
      let current = url;
      for (let redirects = 0; redirects <= 3; redirects++) {
        if (controller.signal.aborted) throw cancelled();
        const response2 = await fetcher(current, {
          method: "GET",
          redirect: "manual",
          credentials: "omit",
          cache: "no-store",
          signal: controller.signal,
          headers: { accept: current.startsWith(API) ? "application/vnd.github+json" : "application/octet-stream", "user-agent": "dsh-archive-delete-updater", "x-github-api-version": "2022-11-28" }
        });
        if (controller.signal.aborted) {
          void response2.body?.cancel().catch(() => {
          });
          throw cancelled();
        }
        if (response2.redirected || response2.url && response2.url !== current) throw error("update-redirect-rejected", "The update server redirected outside the expected request.");
        if ([301, 302, 303, 307, 308].includes(response2.status)) {
          void response2.body?.cancel().catch(() => {
          });
          const location = response2.headers.get("location");
          if (!location) throw invalid2();
          const next = new URL(location, current);
          if (url.startsWith(API) || next.protocol !== "https:" || next.username || next.password || next.port || next.hash || !["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(next.hostname) || next.hostname === "github.com" && next.href !== url) throw error("update-redirect-rejected", "The update download redirected to an untrusted location.");
          current = next.href;
          continue;
        }
        if (!response2.ok) {
          void response2.body?.cancel().catch(() => {
          });
          if (response2.status === 403 || response2.status === 429) {
            const now = Date.now();
            const header = response2.headers.get("retry-after");
            const reset = response2.headers.get("x-ratelimit-reset");
            const after = header && /^\d+$/.test(header) ? now + Number(header) * 1e3 : header ? Date.parse(header) : NaN;
            const limitReset = reset && /^\d+$/.test(reset) ? Number(reset) * 1e3 : NaN;
            const requested = [after, limitReset].filter((value) => Number.isSafeInteger(value) && value > now);
            retryAt = Math.min(now + 7 * 864e5, Math.max(now + 6e4, ...requested));
            throw new UpdateRateLimitError(retryAt);
          }
          throw error(response2.status === 404 ? "update-release-unavailable" : "update-network", "The GitHub release could not be downloaded.");
        }
        const length = response2.headers.get("content-length");
        if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum)) {
          void response2.body?.cancel().catch(() => {
          });
          throw error("update-response-too-large", "The update response exceeds its size limit.");
        }
        const chunks = [];
        let bytes = 0;
        reader = response2.body?.getReader();
        if (!reader) throw invalid2();
        for (; ; ) {
          const part = await reader.read();
          if (part.done) break;
          if (controller.signal.aborted) throw cancelled();
          bytes += part.value.byteLength;
          if (bytes > maximum) throw error("update-response-too-large", "The update response exceeds its size limit.");
          chunks.push(Buffer.from(part.value));
        }
        return Buffer.concat(chunks, bytes);
      }
      throw error("update-redirect-rejected", "The update download redirected too many times.");
    };
    try {
      return await Promise.race([execute(), abort]);
    } catch (caught) {
      if (caught instanceof ArchiveError) throw caught;
      if (controller.signal.aborted) throw cancelled();
      throw error("update-network", "The GitHub update request failed.");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      void reader?.cancel().catch(() => {
      });
    }
  }
  async function resolveRelease(item, signal) {
    const name2 = `qwqbig-dsh-archive-delete-${item.version}.tgz`;
    const specificName = name2.replace(/\.tgz$/, `.dsh-${options.hostVersion}.update.json`);
    const metadataName = item.assets.some((value) => value.name === specificName) ? specificName : name2.replace(/\.tgz$/, ".update.json");
    const asset = item.assets.filter((value) => value.name === name2);
    const meta = item.assets.filter((value) => value.name === metadataName);
    if (!asset.length || !meta.length) return;
    if (asset.length !== 1 || meta.length !== 1) throw invalid2();
    const packed = asset[0];
    const metadataAsset = meta[0];
    const assetUrl = `${WEB}/download/${item.tag}/${name2}`;
    const metadataUrl = `${WEB}/download/${item.tag}/${metadataName}`;
    if (!integer(packed.id) || !integer(metadataAsset.id) || packed.state !== "uploaded" || metadataAsset.state !== "uploaded" || !integer(packed.size) || packed.size > limits.assetBytes || !integer(metadataAsset.size) || metadataAsset.size > limits.metadataBytes || packed.browser_download_url !== assetUrl || metadataAsset.browser_download_url !== metadataUrl) throw invalid2();
    const bytes = await read(metadataUrl, limits.metadataBytes, signal);
    if (bytes.byteLength !== metadataAsset.size) throw invalid2();
    const info = metadata(json(bytes), item.version, name2);
    if (info.asset.bytes !== packed.size || packed.digest != null && packed.digest !== `sha256:${info.asset.sha256}`) throw invalid2();
    if (info.requiredDshVersion !== options.hostVersion || !info.platforms.includes(options.platform)) return;
    const id2 = createHash5("sha256").update(JSON.stringify({
      release: item.id,
      asset: packed.id,
      metadata: metadataAsset.id,
      version: item.version,
      sha256: info.asset.sha256,
      bytes: packed.size,
      host: info.requiredDshVersion,
      platforms: info.platforms
    })).digest("hex");
    const candidate2 = {
      id: id2,
      version: item.version,
      requiredDshVersion: info.requiredDshVersion,
      publishedAt: item.publishedAt,
      releaseUrl: `${WEB}/tag/${item.tag}`,
      notes: item.notes,
      assetBytes: info.asset.bytes
    };
    return { pin: { candidate: candidate2, assetUrl, sha256: info.asset.sha256 }, releaseId: item.id, metadataId: metadataAsset.id };
  }
  const trusted = (pin) => {
    const record3 = known.get(pin.candidate.id);
    if (!record3 || !samePin(record3.pin, pin)) throw error("update-source-changed", "The confirmed update changed. Check for updates again.");
    return record3;
  };
  return {
    async check(signal) {
      return withBudget(signal, async (signal2) => {
        const response2 = json(await read(`${API}?per_page=20`, limits.releasesBytes, signal2));
        if (!Array.isArray(response2)) throw invalid2();
        const newer = response2.slice(0, 20).flatMap((value) => {
          const item = release(value);
          return item && compare(item.version, options.currentVersion) > 0 ? [item] : [];
        }).sort((a, b) => compare(b.version, a.version)).slice(0, 5);
        let failure2;
        for (const item of newer) {
          try {
            const resolved = await resolveRelease(item, signal2);
            if (!resolved) continue;
            known.set(resolved.pin.candidate.id, structuredClone(resolved));
            while (known.size > 8) known.delete(known.keys().next().value);
            return { availability: "available", candidate: structuredClone(resolved.pin.candidate), pinned: structuredClone(resolved.pin) };
          } catch (caught) {
            if (caught instanceof ArchiveError && caught.code === "update-metadata-invalid") failure2 = caught;
            else throw caught;
          }
        }
        if (failure2) throw failure2;
        return newer.length ? { availability: "incompatible", code: "update-incompatible" } : { availability: "current" };
      });
    },
    async revalidate(pin, signal) {
      return withBudget(signal, async (signal2) => {
        const record3 = trusted(pin);
        const item = release(json(await read(`${API}/${record3.releaseId}`, limits.releasesBytes, signal2)));
        if (!item || item.id !== record3.releaseId || compare(item.version, options.currentVersion) <= 0) throw error("update-source-changed", "The confirmed release is no longer available.");
        const current = await resolveRelease(item, signal2);
        if (!current || !samePin(current.pin, record3.pin)) throw error("update-source-changed", "The confirmed update changed. Check for updates again.");
      });
    },
    async download(pin, signal) {
      return withBudget(signal, async (signal2) => {
        const record3 = trusted(pin);
        const bytes = await read(record3.pin.assetUrl, Math.min(limits.assetBytes, record3.pin.candidate.assetBytes), signal2);
        if (bytes.byteLength !== record3.pin.candidate.assetBytes || createHash5("sha256").update(bytes).digest("hex") !== record3.pin.sha256)
          throw error("update-checksum", "The downloaded update does not match its confirmed SHA-256 checksum.");
        await validatePackage(bytes, record3.pin.candidate.version, options.hostVersion, limits);
        if (signal2?.aborted) throw error("update-cancelled", "The update request was cancelled.");
        return bytes;
      });
    }
  };
}
function octal(header, start, length) {
  const text2 = header.subarray(start, start + length).toString("ascii").replace(/\0.*$/, "").trim();
  if (!/^[0-7]+$/.test(text2)) throw packageInvalid();
  const value = Number.parseInt(text2, 8);
  if (!Number.isSafeInteger(value)) throw packageInvalid();
  return value;
}
function text(header, start, length) {
  const field = header.subarray(start, start + length);
  const end = field.indexOf(0);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(end < 0 ? field : field.subarray(0, end));
  } catch {
    throw packageInvalid();
  }
}
async function validatePackage(bytes, version, hostVersion, limits) {
  if (!stable(version) || !SEMVER.test(hostVersion) || !bytes.byteLength || bytes.byteLength > limits.assetBytes) throw packageInvalid();
  let tar;
  try {
    tar = await new Promise((resolve8, reject) => gunzip(bytes, { maxOutputLength: limits.expandedBytes }, (caught, value) => caught ? reject(caught) : resolve8(value)));
  } catch {
    throw packageInvalid();
  }
  if (tar.length % 512 !== 0) throw packageInvalid();
  const seen = /* @__PURE__ */ new Set();
  const filePaths = /* @__PURE__ */ new Set();
  const files = /* @__PURE__ */ new Map();
  let terminated = false;
  let count = 0;
  for (let offset = 0; offset < tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) {
      if (offset + 1024 > tar.length || !tar.subarray(offset).every((value) => value === 0)) throw packageInvalid();
      terminated = true;
      break;
    }
    if (++count > limits.tarEntries || header.length !== 512 || !["ustar\0", "ustar "].includes(header.subarray(257, 263).toString("ascii"))) throw packageInvalid();
    let checksum = 0;
    for (let index = 0; index < 512; index++) checksum += index >= 148 && index < 156 ? 32 : header[index];
    if (octal(header, 148, 8) !== checksum) throw packageInvalid();
    const type = header[156];
    if (type !== 0 && type !== 48 && type !== 53) throw packageInvalid();
    const prefix = text(header, 345, 155);
    let name2 = `${prefix ? `${prefix}/` : ""}${text(header, 0, 100)}`;
    if (type === 53) name2 = name2.replace(/\/$/, "");
    if (name2.length > 512 || !name2 || name2.split("/").some((part) => !part || part === "." || part === ".." || /[\\<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part)) || name2 !== "package" && !name2.startsWith("package/") || name2.split("/").includes("node_modules") || seen.has(name2.toLowerCase())) throw packageInvalid();
    const lower = name2.toLowerCase();
    if ([...filePaths].some((path) => lower.startsWith(`${path}/`)) || type !== 53 && [...seen].some((path) => path.startsWith(`${lower}/`))) throw packageInvalid();
    seen.add(lower);
    const size = octal(header, 124, 12);
    const mode = octal(header, 100, 8);
    if ((mode & 3584) !== 0 || type === 53 && size !== 0 || offset + 512 + size > tar.length) throw packageInvalid();
    if (type !== 53) {
      filePaths.add(lower);
      files.set(name2, tar.subarray(offset + 512, offset + 512 + size));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (!terminated) throw packageInvalid();
  const manifest = files.get("package/package.json");
  if (!manifest || manifest.length > 64 * 1024) throw packageInvalid();
  let pkg;
  try {
    pkg = json(manifest);
  } catch {
    throw packageInvalid();
  }
  if (!object3(pkg) || pkg.name !== PACKAGE_NAME || pkg.version !== version || !supportedPackageDshVersions(pkg).includes(hostVersion) || pkg.main !== "./lib/index.js" || !object3(pkg.dsh) || pkg.dsh.manifestVersion !== 1 || !object3(pkg.dsh.bundle) || pkg.dsh.bundle.patch !== "./cordis.patch.yml") throw packageInvalid();
  for (const path of ["package/cordis.patch.yml", "package/lib/index.js", "package/lib/client.js"]) if (!files.get(path)?.length) throw packageInvalid();
  for (const key of ["dependencies", "optionalDependencies"]) {
    const value = pkg[key];
    if (value !== void 0 && (!object3(value) || Object.keys(value).length !== 0)) throw packageInvalid();
  }
  for (const key of ["bundleDependencies", "bundledDependencies"]) if (pkg[key] !== void 0 && !(Array.isArray(pkg[key]) && pkg[key].length === 0)) throw packageInvalid();
  if (pkg.scripts !== void 0 && (!object3(pkg.scripts) || ["preinstall", "install", "postinstall", "prepare"].some((name2) => Object.hasOwn(pkg.scripts, name2)))) throw packageInvalid();
  if (pkg.peerDependencies !== void 0) {
    if (!object3(pkg.peerDependencies) || !object3(pkg.peerDependenciesMeta)) throw packageInvalid();
    for (const [name2, value] of Object.entries(pkg.peerDependencies)) {
      const meta = pkg.peerDependenciesMeta[name2];
      if (!PEERS.has(name2) || typeof value !== "string" || value.length > 100 || !/^[\dA-Za-z.*^~<>=| -]+$/.test(value) || !object3(meta) || meta.optional !== true) throw packageInvalid();
    }
  }
  return { primaryDshVersion: pkg.engines.dsh, supportedDshVersions: supportedPackageDshVersions(pkg) };
}
async function validateUpdatePackage(bytes, version, requiredDshVersion) {
  await validatePackage(bytes, version, requiredDshVersion, MAX);
}

// src/update-host.ts
var UUID4 = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
var VERSION2 = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
var object4 = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function get(ctx, name2) {
  try {
    return ctx.get?.(name2) ?? ctx[name2];
  } catch {
    return void 0;
  }
}
function original(value) {
  if (!object4(value) && typeof value !== "function") return value;
  try {
    return value[Symbol.for("cordis.original")] ?? value;
  } catch {
    return value;
  }
}
function profileOf(value) {
  if (!object4(value) || !["name", "dir", "home", "installAnchor"].every((key) => typeof value[key] === "string")) return void 0;
  const profile = value;
  if (!profile.name || /[/\\\0]/.test(profile.name) || [".", "..", "node_modules"].includes(profile.name)) return void 0;
  if (![profile.dir, profile.home, profile.installAnchor].every((path) => isAbsolute3(path) && !path.includes("\0")) || !samePath(profile.dir, join6(profile.home, "profiles", profile.name))) return void 0;
  return profile;
}
function sameProfile(left, right) {
  return left.name === right.name && ["dir", "home", "installAnchor"].every((key) => samePath(left[key], right[key]));
}
var unavailable = () => new ArchiveError("update-host-unavailable", "The current profile does not provide a supported native plugin update capability.");
var invalidTarget = () => new ArchiveError("update-target-invalid", "This plugin is not an unambiguous profile-owned installation.");
async function createUpdateHost(ctx) {
  const suppliedProfile = profileOf(get(ctx, "profileContext"));
  const profile = suppliedProfile ? { name: suppliedProfile.name, dir: suppliedProfile.dir, home: suppliedProfile.home, installAnchor: suppliedProfile.installAnchor } : void 0;
  let hostVersion = "unknown";
  let manager;
  try {
    if (!profile) throw unavailable();
    const manifest = await readHostManifest(profile.installAnchor);
    if (!object4(manifest) || manifest.name !== "@deepseek-ai/dsh" || typeof manifest.version !== "string") throw unavailable();
    hostVersion = manifest.version;
    if (!isSupportedDshVersion(hostVersion) || object4(manifest.dependencies) && Object.hasOwn(manifest.dependencies, PACKAGE_NAME)) throw unavailable();
    const nativeRequire = createRequire4(profile.installAnchor);
    const managerFile = nativeRequire.resolve("@deepseek-ai/dsh-plugin-manager");
    const managerManifest = await readHostManifest(join6(dirname4(managerFile), "..", "package.json"));
    if (!object4(managerManifest) || managerManifest.name !== "@deepseek-ai/dsh-plugin-manager" || managerManifest.version !== hostVersion) throw unavailable();
    const native = await import(pathToFileURL2(managerFile).href);
    const found = original(get(ctx, "pluginManager"));
    if (typeof native.PluginManager !== "function" || !(found instanceof native.PluginManager)) throw unavailable();
    const candidate2 = found;
    const managerProfile = profileOf(candidate2.profile);
    if (!managerProfile || !sameProfile(profile, managerProfile) || typeof candidate2.installBundle !== "function" || typeof candidate2.listBundles !== "function") throw unavailable();
    manager = candidate2;
  } catch {
  }
  const installed = async () => {
    if (!profile || !manager || !isSupportedDshVersion(hostVersion)) throw unavailable();
    const current = profileOf(get(ctx, "profileContext"));
    const owner = profileOf(manager.profile);
    if (!current || !owner || !sameProfile(profile, current) || !sameProfile(profile, owner) || original(get(ctx, "pluginManager")) !== manager) throw unavailable();
    assertLocalStoragePath(profile.dir);
    assertLocalStoragePath(profile.home);
    const profileEntry = await lstat8(profile.dir);
    const canonicalProfile = await realpath5(profile.dir);
    if (!profileEntry.isDirectory() || profileEntry.isSymbolicLink() || !samePath(canonicalProfile, profile.dir)) throw invalidTarget();
    await assertCanonicalStoragePath(profile.dir, canonicalProfile);
    const manifest = await readBoundedJson(join6(profile.dir, "package.json"));
    if (!object4(manifest) || !object4(manifest.dependencies) || typeof manifest.dependencies[PACKAGE_NAME] !== "string") throw invalidTarget();
    const source = manifest.dependencies[PACKAGE_NAME];
    if (!source || source.includes("\0")) throw invalidTarget();
    const packageDirectory = await realpath5(join6(profile.dir, "node_modules", PACKAGE_NAME));
    if (!isWithin(join6(canonicalProfile, "node_modules"), packageDirectory)) throw invalidTarget();
    try {
      const installationCopy = await realpath5(createRequire4(profile.installAnchor).resolve(`${PACKAGE_NAME}/package.json`));
      if (!samePath(dirname4(installationCopy), packageDirectory)) throw invalidTarget();
    } catch (error2) {
      if (!object4(error2) || error2.code !== "MODULE_NOT_FOUND") throw error2;
    }
    const target = await readBoundedJson(join6(packageDirectory, "package.json"));
    if (!object4(target) || target.name !== PACKAGE_NAME || typeof target.version !== "string" || !VERSION2.test(target.version) || !object4(target.dsh) || !object4(target.dsh.bundle) || typeof target.dsh.bundle.patch !== "string") throw invalidTarget();
    const rows = await manager.listBundles();
    const matches = Array.isArray(rows) ? rows.filter((row2) => object4(row2) && row2.name === PACKAGE_NAME) : [];
    const row = matches[0];
    if (matches.length !== 1 || !object4(row) || row.installed !== true || row.availability !== "profile" || row.removable !== true || row.version !== target.version || typeof row.source !== "string" || row.error !== void 0) throw invalidTarget();
    return { version: target.version, source };
  };
  let canInstall = manager !== void 0;
  if (canInstall) {
    try {
      await installed();
    } catch {
      canInstall = false;
    }
  }
  let profileId = profile?.dir ?? "unavailable";
  if (canInstall && profile) profileId = await realpath5(profile.dir);
  if (process.platform === "win32") profileId = profileId.toLowerCase();
  return {
    profileId,
    hostVersion,
    loadedVersion: PLUGIN_VERSION,
    canInstall,
    installed,
    install: async (packagePath, version, requestId2) => {
      if (!canInstall || !manager || !profile) return { status: "failed", code: "update-host-unavailable" };
      if (!VERSION2.test(version) || !UUID4.test(requestId2)) return { status: "failed", code: "invalid-request" };
      try {
        await installed();
        const packages = join6(profile.home, "archive-delete", "updates", "packages");
        if (!isAbsolute3(packagePath) || !samePath(dirname4(packagePath), packages) || !new RegExp(`^${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-[a-f0-9]{64}\\.tgz$`).test(basename4(packagePath)))
          return { status: "failed", code: "update-package-invalid" };
        for (const path of [profile.home, join6(profile.home, "archive-delete"), join6(profile.home, "archive-delete", "updates"), packages]) {
          const entry2 = await lstat8(path);
          if (!entry2.isDirectory() || entry2.isSymbolicLink() || !samePath(await realpath5(path), resolve7(path))) return { status: "failed", code: "update-package-invalid" };
          await assertCanonicalStoragePath(path);
          await assertPrivateDirectory(path);
        }
        const entry = await lstat8(packagePath);
        if (!entry.isFile() || entry.isSymbolicLink() || !samePath(await realpath5(packagePath), resolve7(packagePath))) return { status: "failed", code: "update-package-invalid" };
        if (process.platform !== "win32" && (typeof process.getuid === "function" && entry.uid !== process.getuid() || (entry.mode & 18) !== 0))
          return { status: "failed", code: "update-package-invalid" };
        if (entry.size > 16 * 1024 * 1024) return { status: "failed", code: "update-package-invalid" };
        const handle = await open6(packagePath, constants5.O_RDONLY | (constants5.O_NOFOLLOW ?? 0));
        try {
          const held = await handle.stat({ bigint: true });
          const before = await lstat8(packagePath, { bigint: true });
          if (!held.isFile() || before.isSymbolicLink() || held.size > 16n * 1024n * 1024n || held.dev !== before.dev || held.ino !== before.ino) return { status: "failed", code: "update-package-invalid" };
          const bytes = Buffer.alloc(Number(held.size));
          let offset = 0;
          while (offset < bytes.length) {
            const read = await handle.read(bytes, offset, bytes.length - offset, offset);
            if (read.bytesRead === 0) break;
            offset += read.bytesRead;
          }
          const overflow = await handle.read(Buffer.alloc(1), 0, 1, offset);
          const after = await lstat8(packagePath, { bigint: true });
          if (offset !== bytes.length || overflow.bytesRead !== 0 || after.isSymbolicLink() || after.dev !== held.dev || after.ino !== held.ino || after.size !== held.size || after.mtimeNs !== held.mtimeNs || after.ctimeNs !== held.ctimeNs || basename4(packagePath) !== `${version}-${createHash6("sha256").update(bytes).digest("hex")}.tgz`)
            return { status: "failed", code: "update-package-invalid" };
          await validateUpdatePackage(bytes, version, hostVersion);
        } finally {
          await handle.close();
        }
      } catch {
        return { status: "failed", code: "update-target-invalid" };
      }
      let result2;
      try {
        result2 = await manager.installBundle(packagePath, { requestId: requestId2, saveExact: true, enabled: true });
      } catch {
        return { status: "unknown", code: "update-install-unknown" };
      }
      if (!object4(result2)) return { status: "unknown", code: "update-install-unknown" };
      if (object4(result2.error)) return { status: "failed", code: typeof result2.error.code === "string" ? result2.error.code : "update-install-failed" };
      if (result2.application === "failed" || result2.application === "cancelled") return { status: "failed", code: "update-install-failed" };
      if (Array.isArray(result2.pendingBuilds) && result2.pendingBuilds.length) return { status: "failed", code: "update-build-approval-required" };
      if (object4(result2.packageResult) && (result2.packageResult.exitCode !== 0 || result2.packageResult.timedOut === true)) return { status: "failed", code: "update-install-failed" };
      if (!["applied", "restart-required"].includes(String(result2.application)) || result2.bundle !== PACKAGE_NAME || result2.version !== version)
        return { status: "unknown", code: "update-install-unknown" };
      try {
        const after = await installed();
        const source = after.source.replace(/^file:/, "");
        if (after.version !== version || !samePath(resolve7(profile.dir, source), packagePath)) return { status: "unknown", code: "update-install-mismatch" };
      } catch {
        return { status: "unknown", code: "update-install-mismatch" };
      }
      return { status: result2.application === "restart-required" ? "restart-required" : "installed" };
    }
  };
}

// src/index.ts
var name = "dsh-archive-delete";
var inject = ["connection", "workspaceRegistry", "sessionPersistence", "sessions", "sessionProjectionCache", "sessionProjections", "profileContext", "dshHomePath"];
function unavailableApi(status) {
  const reject = async () => {
    throw new ArchiveError("unsupported-host", status.reason ?? "The archive plugin is unavailable.");
  };
  return { list: async () => ({ support: status, archived: [], trash: [], recentResults: [] }), preview: reject, execute: reject, cancelPending: reject, storage: reject };
}
async function apply(ctx) {
  let api;
  let lease;
  let archive;
  let inspector;
  let updater;
  let loaded;
  try {
    const adapter = await createDshAdapter(ctx);
    const support = await adapter.capabilities();
    if (!support.supported) {
      ctx.logger?.warn(`${PACKAGE_NAME}: ${support.reason ?? "This host is unsupported."} Archive operations are disabled.`);
      api = unavailableApi(support);
    } else {
      const paths = await getHostPaths(ctx);
      const store = new TrashStore({ root: paths.root, sessionsRoot: paths.sessionsRoot });
      lease = await acquirePluginLease(paths.root, getNativeLockExclusive(ctx), { lockNamed: getNativeWindowsLock(ctx) });
      archive = new ArchiveService(adapter, store);
      await archive.initialize();
      inspector = new StorageInspector({ workspaces: () => getStorageWorkspaces(ctx), sources: (workspaceId) => getStorageSources(ctx, workspaceId) });
      api = wrapArchiveApi(archive, inspector);
      try {
        const host = await createUpdateHost(ctx);
        if (host.canInstall) {
          updater = new UpdateService({
            root: paths.root,
            host,
            source: createGithubUpdateSource({ currentVersion: PLUGIN_VERSION, hostVersion: host.hostVersion, platform: process.platform }),
            beginUpdate: () => archive.beginUpdate()
          });
          await updater.initialize();
          api = { ...api, updates: (force) => updater.info(force), installUpdate: (id2, requestId2) => updater.install(id2, requestId2) };
        }
      } catch (error2) {
        await updater?.close();
        updater = void 0;
        ctx.logger?.warn(`[archive-delete] Update checking is unavailable: ${error2 instanceof Error ? error2.message : String(error2)}`);
      }
      loaded = { version: support.version, trash: join7(paths.root, "trash") };
    }
  } catch (error2) {
    await updater?.close();
    await inspector?.close();
    await archive?.close();
    await lease?.release();
    lease = void 0;
    ctx.logger?.warn(`${PACKAGE_NAME}: initialization failed; archive operations are disabled. ${error2 instanceof Error ? error2.message : String(error2)}`);
    api = unavailableApi({
      supported: false,
      version: "unknown",
      platform: process.platform,
      reason: error2 instanceof ArchiveError && error2.code === "store-busy" ? error2.message : "Archive storage could not be initialized. Check the host diagnostics, then reload the plugin."
    });
  }
  try {
    const unmount = registerHostRoutes(ctx, api);
    updater?.start();
    try {
      if (loaded) ctx.logger?.info?.(`[archive-delete] v${PLUGIN_VERSION} loaded \xB7 target DSH ${SUPPORTED_DSH_VERSION_LABEL} (host ${loaded.version}) \xB7 trash ${JSON.stringify(loaded.trash)}`);
    } catch {
    }
    return async () => {
      unmount();
      await updater?.close();
      await inspector?.close();
      await archive?.close();
      await lease?.release();
    };
  } catch (error2) {
    await updater?.close();
    await inspector?.close();
    await archive?.close();
    await lease?.release();
    ctx.logger?.warn(`${PACKAGE_NAME}: the authenticated API could not be registered. ${error2 instanceof Error ? error2.message : String(error2)}`);
    return async () => {
    };
  }
}
export {
  apply,
  inject,
  name
};
