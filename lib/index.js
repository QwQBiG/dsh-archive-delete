// src/contracts.ts
var PACKAGE_NAME = "@qwqbig/dsh-archive-delete";
var API_PATH = "/api/dsh-archive-delete";
var SUPPORTED_DSH_VERSION = "0.2.1-rc.3";
var ArchiveError = class extends Error {
  constructor(code2, message) {
    super(message);
    this.code = code2;
    this.name = "ArchiveError";
  }
};

// src/dsh-adapter.ts
import { createHash } from "node:crypto";
import { constants as constants2 } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { lstat as lstat2, mkdir, open as open2, readFile, readdir, realpath as realpath2 } from "node:fs/promises";
import { basename, dirname, isAbsolute as isAbsolute2, join, relative as relative2, resolve as resolve2, sep as sep2, win32 as win322 } from "node:path";

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
async function assertCanonicalStoragePath(path, canonical) {
  if (process.platform !== "win32") return;
  const physical = canonical ?? await realpath(path);
  assertLocalStoragePath(physical);
  if (!samePath(path, physical))
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
async function readBoundedJson(path, limit = 8 * 1024 * 1024) {
  const before = await lstat(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(limit))
    throw new ArchiveError("corrupt-state", "Recovery metadata is invalid.");
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const held = await handle.stat({ bigint: true });
    const current = await lstat(path, { bigint: true });
    if (!held.isFile() || current.isSymbolicLink() || !current.isFile() || held.size > BigInt(limit) || before.dev !== held.dev || before.ino !== held.ino || current.dev !== held.dev || current.ino !== held.ino)
      throw new ArchiveError("unsafe-path", "Recovery metadata identity changed.");
    const encoded = await handle.readFile("utf8");
    if (Buffer.byteLength(encoded) > limit) throw new ArchiveError("corrupt-state", "Recovery metadata is too large.");
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
function code(error) {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : void 0;
}
function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function headerId(value) {
  return object(value) && typeof value.id === "string" && value.id.length > 0 && typeof value.version === "number" && typeof value.createdAt === "number";
}
function encodeId(value) {
  if (value === ".") return "~002E";
  if (value === "..") return "~002E~002E";
  return value.replace(/[^A-Za-z0-9._-]/g, (character) => `~${character.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`);
}
function cloneHeader(header) {
  return JSON.parse(JSON.stringify(header));
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
    await (await implementation)(fd);
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
    const api = await implementation;
    if (!isLocalWindowsDriveType(api.driveType(win322.parse(filename).root))) throw new ArchiveError("unsafe-path", "Windows archive operations require a verified local writable drive.");
    const handle = api.createSemaphore(null, 1, 1, windowsSessionLockName(filename));
    if (handle === 0 || handle === 0n) throw Object.assign(new Error("The Windows kernel lock could not be created."), { code: "EIO", win32Code: api.lastError() });
    const acquired = api.wait(handle, 0);
    if (acquired !== 0) {
      const error = acquired === 258 ? { code: "EBUSY" } : { code: "EIO", win32Code: api.lastError() };
      api.close(handle);
      throw Object.assign(new Error("The Windows kernel lock is unavailable."), error);
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
    } catch (error) {
      if (code(error) === "EBUSY") throw new ArchiveError("store-busy", "Another DSH process owns this archive-delete store. Close that instance before enabling mutations here.");
      throw error;
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
  } catch (error) {
    await handle.close();
    if (code(error) === "EAGAIN" || code(error) === "EWOULDBLOCK") throw new ArchiveError("store-busy", "Another DSH process owns this archive-delete store. Close that instance before enabling mutations here.");
    throw error;
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
  return new NativeAdapter(ctx, paths, version, options.platform ?? process.platform, lockExclusive, options.lockNamed ?? getNativeWindowsLock(ctx));
}
var NativeAdapter = class {
  constructor(ctx, paths, version, platform, lockExclusive, lockNamed) {
    this.ctx = ctx;
    this.paths = paths;
    this.version = version;
    this.platform = platform;
    this.lockExclusive = lockExclusive;
    this.lockNamed = lockNamed;
    this.persistence = service(ctx, "sessionPersistence");
    this.registry = service(ctx, "workspaceRegistry");
    this.sessions = service(ctx, "sessions");
    this.cache = service(ctx, "sessionProjectionCache");
  }
  persistence;
  registry;
  sessions;
  cache;
  async capabilities() {
    let reason;
    if (this.platform !== "darwin" && this.platform !== "win32") reason = "Only macOS and Windows Desktop are supported in this release.";
    else if (this.version !== SUPPORTED_DSH_VERSION) reason = `DSH Desktop ${SUPPORTED_DSH_VERSION} is required; the current runtime is ${this.version}. Update DSH Desktop to the required version, then restart this plugin.`;
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
  async snapshots() {
    const snapshots = await this.persistence.list();
    const ids2 = /* @__PURE__ */ new Set();
    for (const snapshot of snapshots) {
      if (!headerId(snapshot.header) || ids2.has(snapshot.header.id)) throw new ArchiveError("invalid-session", "Session identity is missing or duplicated.");
      ids2.add(snapshot.header.id);
    }
    return snapshots;
  }
  async listArchived() {
    await this.requireSupported();
    const snapshots = await this.snapshots();
    const archived = new Set(this.registry.archivedSessionIds);
    const records = this.registry.requireState().workspaceIds.map((id2) => this.registry.requireTable().get(id2)).filter((record2) => record2 !== void 0);
    return snapshots.filter(({ header }) => archived.has(header.id) && header.origin !== "subagent").map(({ header, sizeBytes }) => {
      const children = this.descendants(header.id, snapshots, false);
      const workspace = records.find((record2) => record2.sessionIds.includes(header.id));
      return {
        id: header.id,
        title: titleOf(this.cache, header),
        workspace: workspace?.title ?? workspace?.path ?? "Ungrouped",
        sizeBytes: (sizeBytes ?? 0) + children.reduce((sum, child) => sum + (child.sizeBytes ?? 0), 0),
        descendantCount: children.length
      };
    });
  }
  /** Only explicit subagent ancestry is owned; a fork's parent pointer is not ownership. */
  descendants(id2, snapshots, strict = true) {
    const visited = /* @__PURE__ */ new Set([id2]);
    const result2 = [];
    const walk = (parent) => {
      for (const snapshot of snapshots) {
        if (snapshot.header.parentSession !== parent || snapshot.header.origin !== "subagent") continue;
        if (visited.has(snapshot.header.id)) {
          if (strict) throw new ArchiveError("ambiguous-lineage", "Cyclic subagent ownership prevents safe cleanup.");
          continue;
        }
        visited.add(snapshot.header.id);
        result2.push(snapshot);
        walk(snapshot.header.id);
      }
    };
    walk(id2);
    return result2;
  }
  async inspect(sessionId) {
    await this.requireSupported();
    const snapshots = await this.snapshots();
    const root = snapshots.find(({ header }) => header.id === sessionId);
    if (!root) throw new ArchiveError("session-missing", "The session no longer exists.");
    if (root.header.origin === "subagent") throw new ArchiveError("subagent-target", "Move the parent conversation instead of an individual subagent.");
    const selected = [root, ...this.descendants(sessionId, snapshots)];
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
    const accounts = state.workspaceIds.map((id2) => ({ id: id2, record: this.registry.requireTable().get(id2) })).filter(({ record: record2 }) => record2?.sessionIds.includes(header.id));
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
    } catch (error) {
      await Promise.allSettled(handles.map((handle) => handle.close()));
      if (code(error) === "EAGAIN" || code(error) === "EWOULDBLOCK") return { kind: "busy", message: "Another process holds the session write lock." };
      throw error;
    }
  }
  async acquireWindowsLocated(group, directories, loaded) {
    const leases = [];
    const release = async () => {
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
          await release();
          return { kind: "busy", message: "A session or related task is active." };
        }
        if (loaded.has(member.id)) continue;
        if (directory !== void 0) {
          const entry = await lstat2(directory);
          if (!isAbsolute2(directory) || !entry.isDirectory() || entry.isSymbolicLink()) throw new ArchiveError("unsafe-path", "A recovery location is not a plain directory.");
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
        await release();
        return { kind: "loaded", message: "An idle session is still held by this DSH process." };
      }
      let released = false;
      return { kind: "acquired", lease: { release: async () => {
        if (!released) {
          released = true;
          await release();
        }
      } } };
    } catch (error) {
      await release().catch(() => {
      });
      if (code(error) === "EBUSY") return { kind: "busy", message: "Another process holds the session write lock." };
      throw error;
    }
  }
  async restoreProjections(member) {
    const reader = await this.persistence.open(member.id, "read");
    try {
      if (JSON.stringify(reader.header) !== JSON.stringify(member.header)) throw new ArchiveError("restore-identity", "Restored session identity changed before projection recovery.");
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
        const record2 = await table.update(workspaceId, (current) => ({ ...current, sessionIds: current.sessionIds.filter((id2) => !ids2.has(id2)), updatedAt: (/* @__PURE__ */ new Date()).toISOString() }));
        const entity = this.registry.entities.get(workspaceId);
        if (entity) entity.record = record2;
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
      if (!snapshot || JSON.stringify(snapshot.header) !== JSON.stringify(member.header)) throw new ArchiveError("restore-identity", "Restored session identity does not match the recorded session.");
      await this.restoreProjections(member);
      restored.push({ member, snapshot });
    }
    await this.registry.enqueueOperation(async () => {
      const table = this.registry.requireTable();
      for (const { member, snapshot } of restored) {
        await this.registry.indexHeader(snapshot.header);
        const account = member.workspaceId ? table.get(member.workspaceId) : void 0;
        if (member.workspaceId && account && account.path === member.workspacePath) {
          const record2 = await table.update(member.workspaceId, (current) => {
            if (current.sessionIds.includes(member.id)) return current;
            const sessionIds = [...current.sessionIds];
            sessionIds.splice(Math.min(Math.max(member.accountIndex ?? sessionIds.length, 0), sessionIds.length), 0, member.id);
            return { ...current, sessionIds, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
          });
          const entity = this.registry.entities.get(member.workspaceId);
          if (entity) entity.record = record2;
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
import { basename as basename2, dirname as dirname2, join as join2, resolve as resolve3 } from "node:path";
var UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
var LOG = /^session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/;
var TEMP = /^(?:session\.migration\.[\w.-]+\.tmp|session(?:\.v\d+)?\.jsonl(?:\.zstd)?\.[a-f\d]+\.tmp)$/i;
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
  async initialize() {
    assertLocalStoragePath(this.root);
    assertLocalStoragePath(this.sessionsRoot);
    await assertPlainDirectory(this.sessionsRoot);
    if (isWithin(this.sessionsRoot, this.root) || samePath(this.root, this.sessionsRoot))
      throw new ArchiveError("unsafe-path", "Trash must be outside the session store.");
    if (!await exists(this.root)) await mkdir2(this.root, { mode: 448, recursive: true });
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
    const root = await realpath3(this.sessionsRoot);
    for (const member of group.members) {
      assertLocalStoragePath(member.directory);
      const directory = resolve3(member.directory);
      if (!isWithin(this.sessionsRoot, directory) || !samePath(dirname2(dirname2(directory)), this.sessionsRoot) || basename2(directory) !== sessionDirectoryName(member.id))
        throw new ArchiveError("unsafe-path", "Session directory is outside the expected layout.");
      await assertPlainDirectory(dirname2(directory));
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
    let logs = 0;
    for (const name2 of names) {
      if (!(LOG.test(name2) || TEMP.test(name2) || name2 === "session.lock"))
        throw new ArchiveError("unknown-file", "An unexpected file prevents this operation.");
      const s = await lstat3(join2(directory, name2));
      if (!s.isFile() || s.isSymbolicLink()) throw new ArchiveError("unsafe-path", "Session data contains an unsafe entry.");
      if (LOG.test(name2)) logs++;
    }
    if (!logs) throw new ArchiveError("missing-log", "The session log is missing.");
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
    if (!await exists(path)) return true;
    await this.validateContainer(path, op.group, true);
    for (let i = 0; i < op.group.members.length; i++) if (await exists(join2(path, String(i)))) return false;
    await unlink(join2(path, "manifest.json")).catch((e) => {
      if (!isMissing(e)) throw e;
    });
    await rmdir(path);
    return true;
  }
  async manifest(entryId) {
    const directory = this.entry(entryId);
    await assertPlainDirectory(directory);
    const m = await this.readJson(join2(directory, "manifest.json"));
    if (m.schema !== 1 || m.id !== entryId || !Number.isFinite(m.trashedAt)) throw new ArchiveError("corrupt-state", "Invalid trash manifest.");
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
  async entryFingerprint(entryId) {
    const manifest = await this.manifest(entryId);
    const hash = createHash2("sha256").update(JSON.stringify(manifest));
    for (let i = 0; i < manifest.group.members.length; i++) {
      const directory = join2(this.entry(entryId), String(i));
      if (!await exists(directory)) {
        hash.update(`missing:${i}`);
        continue;
      }
      for (const name2 of (await readdir2(directory)).sort()) {
        if (name2 === "session.lock") continue;
        const st = await lstat3(join2(directory, name2), { bigint: true });
        hash.update(`${i}:${name2}:${st.dev}:${st.ino}:${st.size}:${st.mtimeNs}`);
      }
    }
    return hash.digest("hex");
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
    if (!await exists(this.area("trash"))) return [];
    const entries = [];
    for (const key of await readdir2(this.area("trash"))) {
      if (!UUID.test(key)) throw new ArchiveError("corrupt-state", "An unknown trash entry needs attention.");
      const journals = (await this.operations()).filter((o) => o.entryId === key);
      if (journals.some((o) => o.phase === "restored-metadata" || o.phase === "restored")) continue;
      if (!await exists(join2(this.entry(key), "manifest.json")) && journals.some((o) => o.phase === "purging" || o.phase === "purged")) continue;
      const m = await this.manifest(key);
      entries.push({
        id: key,
        sessionId: m.group.sessionId,
        title: m.group.title,
        trashedAt: m.trashedAt,
        sizeBytes: m.group.members.reduce((n, s) => n + s.sizeBytes, 0),
        memberCount: m.group.members.length
      });
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
    await assertPlainDirectory(directory);
    const m = await this.readJson(join2(directory, "manifest.json"));
    if (m.schema !== 1 || m.id !== entryId) throw new ArchiveError("corrupt-state", "Invalid trash manifest.");
    validateGroup(m.group);
    await this.validateSource(m.group, true);
    await this.validateContainer(directory, m.group, true);
    const op = { schema: 1, id: randomUUID(), entryId, phase: "purging", group: m.group, createdAt: Date.now(), moved: [], ...context };
    await this.writeOperation(op);
    for (let i = 0; i < m.group.members.length; i++) {
      const p = join2(directory, String(i));
      if (!await exists(p)) continue;
      for (const file of await readdir2(p)) await unlink(join2(p, file));
      await rmdir(p);
    }
    await unlink(join2(directory, "manifest.json"));
    await rmdir(directory);
    await syncDirectory(this.area("trash"));
    op.phase = "purged";
    await this.writeOperation(op);
    return op;
  }
};

// src/request-journal.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import { lstat as lstat4, open as open4, readdir as readdir3, rename as rename2, unlink as unlink2 } from "node:fs/promises";
import { join as join3, resolve as resolve4 } from "node:path";
var UUID2 = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
var STATUSES = /* @__PURE__ */ new Set(["moved", "pending", "restored", "purged", "cancelled", "skipped", "failed"]);
function missing(error) {
  return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT";
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
    } catch (error) {
      if (missing(error)) return void 0;
      throw error;
    }
    validate(value, id2);
    if (fingerprint !== void 0 && value.fingerprint !== fingerprint)
      throw new ArchiveError("request-conflict", "This request identifier was already used.");
    value.result.counts = counts(value.result.items);
    return value;
  }
  async write(record2, budget = 8 * 1024 * 1024) {
    await this.directorySafe();
    const encoded = `${JSON.stringify(record2)}
`;
    if (Buffer.byteLength(encoded) > budget)
      throw new ArchiveError("metadata-too-large", "Recovery metadata is too large. Select a smaller batch.");
    const path = this.path(record2.requestId);
    const temporary = `${path}.${randomUUID2()}.tmp`;
    let handle;
    try {
      handle = await open4(temporary, "wx", 384);
      await handle.writeFile(encoded);
      await handle.sync();
      await handle.close();
      handle = void 0;
      await rename2(temporary, path);
      await syncDirectory(this.directory);
    } catch (error) {
      if (handle) await handle.close().catch(() => {
      });
      await unlink2(temporary).catch(() => {
      });
      throw error;
    }
  }
  async discardTemps(id2) {
    const names = await readdir3(this.directory);
    let changed = false;
    for (const name2 of names) {
      const match = /^(.+)\.json\.(.+)\.tmp$/.exec(name2);
      if (!match || !UUID2.test(match[1]) || !UUID2.test(match[2]) || id2 !== void 0 && match[1] !== id2) continue;
      const path = join3(this.directory, name2);
      const stat = await lstat4(path);
      if (!stat.isFile() || stat.isSymbolicLink() || process.platform !== "win32" && ((stat.mode & 63) !== 0 || typeof process.getuid === "function" && stat.uid !== process.getuid()))
        throw new ArchiveError("unsafe-path", "A temporary request receipt needs attention.");
      await unlink2(path);
      changed = true;
    }
    if (changed) {
      await syncDirectory(this.directory);
    }
  }
  async begin(id2, fingerprint, context, action) {
    return this.serialize(async () => {
      await this.directorySafe();
      const existing = await this.read(id2, fingerprint);
      if (existing) return existing;
      const record2 = {
        schema: 1,
        requestId: requestId(id2),
        fingerprint,
        complete: false,
        ...structuredClone(context),
        result: { operationId: id2, action: action ?? context.preview.action, items: [], counts: counts([]) }
      };
      validate(record2, id2);
      await this.write(record2, 6 * 1024 * 1024);
      return structuredClone(record2);
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
      const record2 = await this.read(id2);
      if (!record2) throw new ArchiveError("request-missing", "The durable request intent is missing.");
      if (!validItem(item)) throw new ArchiveError("invalid-request", "The request result is invalid.");
      const targets = record2.complete ? record2.result.items.map((value) => value.id) : record2.preview.items.map((value) => value.id);
      if (!targets.includes(item.id)) throw new ArchiveError("request-conflict", "The result does not belong to this request.");
      const merged = {
        id: item.id,
        title: record2.complete ? "" : item.title.slice(0, 256),
        status: item.status,
        ...item.code === void 0 ? {} : { code: item.code.slice(0, 80) },
        ...item.message === void 0 ? {} : { message: item.message.slice(0, 1024) }
      };
      const resultById = new Map(record2.result.items.map((value) => [value.id, value]));
      resultById.set(item.id, merged);
      record2.result.items = targets.flatMap((target) => {
        const value = resultById.get(target);
        return value ? [value] : [];
      });
      record2.result.counts = counts(record2.result.items);
      await this.write(record2);
      return structuredClone(record2);
    });
  }
  async complete(id2, interrupted = false) {
    return this.serialize(async () => {
      await this.directorySafe();
      const record2 = await this.read(id2);
      if (!record2) throw new ArchiveError("request-missing", "The durable request intent is missing.");
      if (record2.complete) {
        await this.discardTemps(id2);
        return record2.result;
      }
      const saved = new Map(record2.result.items.map((item) => [item.id, item]));
      const absent = record2.preview.items.filter((item) => !saved.has(item.id));
      if (absent.length && !interrupted) throw new ArchiveError("request-incomplete", "Some request targets have no durable result.");
      for (const item of absent) saved.set(item.id, {
        id: item.id,
        title: "",
        status: "failed",
        code: "operation-interrupted",
        message: "The operation was interrupted before this target completed. Review it before retrying."
      });
      record2.result.items = record2.preview.items.map((item) => ({ ...saved.get(item.id), title: "" }));
      record2.result.counts = counts(record2.result.items);
      record2.complete = true;
      delete record2.preview;
      delete record2.groups;
      delete record2.fingerprints;
      await this.write(record2);
      await this.discardTemps(id2);
      return structuredClone(record2.result);
    });
  }
  async records() {
    await this.directorySafe();
    await this.discardTemps();
    const result2 = [];
    for (const name2 of (await readdir3(this.directory)).sort()) {
      if (!name2.endsWith(".json")) continue;
      const id2 = name2.slice(0, -5);
      requestId(id2);
      const record2 = await this.read(id2);
      if (record2) result2.push(record2);
    }
    return result2;
  }
  async incomplete() {
    return this.serialize(async () => (await this.records()).filter((record2) => !record2.complete));
  }
  async recent() {
    return this.serialize(async () => {
      const records = (await this.records()).filter((record2) => record2.complete);
      const dated = await Promise.all(records.map(async (record2) => ({ record: record2, mtime: (await lstat4(this.path(record2.requestId))).mtimeMs })));
      return dated.sort((a, b) => b.mtime - a.mtime).slice(0, 10).map((value) => value.record.result);
    });
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
function safeError(error) {
  if (error instanceof ArchiveError) return { code: error.code, message: error.message };
  return { code: "operation-failed", message: "The operation could not complete. Its recorded state is available for recovery." };
}
function failure(id2, title, error) {
  const detail = safeError(error);
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
  requests;
  serialize(work) {
    if (this.closing) return Promise.reject(new ArchiveError("plugin-stopping", "The plugin is stopping. Refresh after it reloads."));
    const task = this.tail.then(work, work);
    this.tail = task.catch(() => {
    });
    return task;
  }
  async close() {
    this.closing = true;
    await this.tail;
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
            const changed = failure(op.targetId ?? op.group.sessionId, op.group.title, new ArchiveError("source-changed", MESSAGE["source-changed"]));
            if (op.requestId) await this.requests.record(op.requestId, changed);
            await this.store.finish(op);
            this.startupFailures.push(changed);
            continue;
          }
          const moved = await this.trashGroup(fresh, op, op.requestId ? { requestId: op.requestId, targetId: op.targetId } : void 0);
          if (op.requestId) await this.requests.record(op.requestId, { ...moved, id: op.targetId });
          if (moved.status === "moved") await this.finishTerminals(op.requestId, op.targetId, op.entryId);
          if (moved.status === "failed") this.startupFailures.push(moved);
        } catch (e) {
          const code2 = safeError(e).code;
          if (["not-archived", "source-changed", "missing-session", "session-missing", "session-not-found"].includes(code2)) {
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
    return this.serialize(async () => {
      const support = await this.adapter.capabilities();
      if (!support.supported) return { support, archived: [], trash: [], recentResults: [] };
      const pending = new Map((await this.store.operations()).filter((o) => o.phase === "pending").map((o) => [o.group.sessionId, o]));
      const archived = (await this.adapter.listArchived()).map((s) => {
        const p = pending.get(s.id);
        return p ? { ...s, pending: true, pendingReason: p.reason ?? "Waiting for the next DSH start." } : s;
      });
      const recent = await this.requests.recent();
      if (this.startupFailures.length) recent.unshift(result("startup-recovery", "trash", this.startupFailures));
      return { support, archived, trash: await this.store.list(), recentResults: recent };
    });
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
            const manifest = await this.store.manifest(key);
            title = manifest.group.title;
            if (action === "restore") await this.store.checkRestore(key);
            groups.set(key, manifest.group);
            fingerprints.set(key, await this.store.entryFingerprint(key));
            items.push({
              id: key,
              sessionId: manifest.group.sessionId,
              title,
              memberIds: manifest.group.members.map((m) => m.id),
              sizeBytes: manifest.group.members.reduce((n, m) => n + m.sizeBytes, 0),
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
        const candidate = this.previews.get(previewId);
        if (!candidate || candidate.preview.expiresAt < Date.now()) throw new ArchiveError("preview-expired", "The preview expired. Refresh and review the targets again.");
        prepared = candidate;
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
            outcome = await this.trashGroup(fresh, void 0, { requestId: requestId2, targetId: item.id });
          } else {
            const current = await this.store.manifest(item.id);
            if (groupFingerprint(current.group) !== groupFingerprint(expected) || await this.store.entryFingerprint(item.id) !== prepared.fingerprints.get(item.id))
              throw new ArchiveError("source-changed", MESSAGE["source-changed"]);
            if (prepared.preview.action === "restore") {
              await this.restoreEntry(item.id, { requestId: requestId2, targetId: item.id });
              outcome = { id: item.id, title: item.title, status: "restored" };
            } else {
              await this.purgeEntry(item.id, { requestId: requestId2, targetId: item.id });
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
  async trashGroup(group, pending, context) {
    const lease = await this.adapter.acquire(group);
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
  async restoreEntry(entryId, context) {
    let op;
    const manifest = await this.store.manifest(entryId);
    const held = await this.adapter.acquireLocated(manifest.group, await this.store.entryLocations(entryId));
    if (held.kind !== "acquired") throw new ArchiveError("busy", "Restore is waiting for the session write lock.");
    try {
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
  async purgeEntry(entryId, context) {
    const manifest = await this.store.manifest(entryId);
    const held = await this.adapter.acquireLocated(manifest.group, await this.store.entryLocations(entryId));
    if (held.kind !== "acquired") throw new ArchiveError("busy", "Permanent deletion is waiting for the session write lock.");
    try {
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
function exactKeys(value, keys) {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function ids(value) {
  return Array.isArray(value) && value.length > 0 && value.length <= 100 && value.every((id2) => typeof id2 === "string" && id2.length > 0 && id2.length <= 512 && !id2.includes("\0")) && new Set(value).size === value.length;
}
function parseApiRequest(value) {
  if (record(value)) {
    if (value.action === "list" && exactKeys(value, ["action"])) return { action: "list" };
    if (value.action === "preview" && exactKeys(value, ["action", "operation", "ids"]) && ["trash", "restore", "purge"].includes(String(value.operation)) && ids(value.ids)) {
      return { action: "preview", operation: value.operation, ids: value.ids };
    }
    if (value.action === "execute" && exactKeys(value, ["action", "previewId", "requestId"]) && typeof value.previewId === "string" && value.previewId.length <= 100 && typeof value.requestId === "string" && value.requestId.length <= 100) {
      return { action: "execute", previewId: value.previewId, requestId: value.requestId };
    }
    if (value.action === "cancelPending" && exactKeys(value, ["action", "ids", "requestId"]) && ids(value.ids) && typeof value.requestId === "string" && value.requestId.length <= 100) {
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
      }
      return response({ ok: true, value });
    } catch (error) {
      const detail = safeError(error);
      const status = detail.code === "request-too-large" ? 413 : detail.code === "invalid-request" ? 400 : detail.code === "operation-failed" ? 500 : 409;
      return response({ ok: false, error: detail }, status);
    }
  };
}
function registerHostRoutes(ctx, api) {
  const connection = ctx.get?.("connection") ?? ctx.connection;
  if (!connection || typeof connection.fetch?.register !== "function") throw new ArchiveError("unsupported-host", "DSH authenticated Fetch routes are unavailable.");
  return connection.fetch.register({ path: API_PATH, methods: ["POST"], requestBody: "buffered", fetch: createRequestHandler(api) });
}

// src/index.ts
var name = "dsh-archive-delete";
var inject = ["connection", "workspaceRegistry", "sessionPersistence", "sessions", "sessionProjectionCache", "sessionProjections", "profileContext", "dshHomePath"];
function unavailableApi(status) {
  const reject = async () => {
    throw new ArchiveError("unsupported-host", status.reason ?? "The archive plugin is unavailable.");
  };
  return { list: async () => ({ support: status, archived: [], trash: [], recentResults: [] }), preview: reject, execute: reject, cancelPending: reject };
}
async function apply(ctx) {
  let api;
  let lease;
  let archive;
  try {
    const adapter = await createDshAdapter(ctx);
    const support = await adapter.capabilities();
    if (!support.supported) {
      ctx.logger?.warn(`${PACKAGE_NAME}: ${support.reason ?? "This host is unsupported."} Archive operations are disabled.`);
      api = unavailableApi(support);
    } else {
      const paths = await getHostPaths(ctx);
      const store = new TrashStore({ root: paths.root, sessionsRoot: paths.sessionsRoot });
      await store.initialize();
      lease = await acquirePluginLease(paths.root, getNativeLockExclusive(ctx), { lockNamed: getNativeWindowsLock(ctx) });
      archive = new ArchiveService(adapter, store);
      await archive.initialize();
      api = archive;
    }
  } catch (error) {
    await archive?.close();
    await lease?.release();
    lease = void 0;
    ctx.logger?.warn(`${PACKAGE_NAME}: initialization failed; archive operations are disabled. ${error instanceof Error ? error.message : String(error)}`);
    api = unavailableApi({
      supported: false,
      version: "unknown",
      platform: process.platform,
      reason: error instanceof ArchiveError && error.code === "store-busy" ? error.message : "Archive storage could not be initialized. Check the host diagnostics, then reload the plugin."
    });
  }
  try {
    const unmount = registerHostRoutes(ctx, api);
    return async () => {
      unmount();
      await archive?.close();
      await lease?.release();
    };
  } catch (error) {
    await archive?.close();
    await lease?.release();
    ctx.logger?.warn(`${PACKAGE_NAME}: the authenticated API could not be registered. ${error instanceof Error ? error.message : String(error)}`);
    return async () => {
    };
  }
}
export {
  apply,
  inject,
  name
};
