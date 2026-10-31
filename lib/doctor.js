#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/contracts.ts
function isSupportedDshVersion(version2) {
  return SUPPORTED_DSH_VERSIONS.includes(version2);
}
var PACKAGE_NAME, SUPPORTED_DSH_VERSION, SUPPORTED_DSH_VERSIONS, SUPPORTED_DSH_VERSION_LABEL, ArchiveError;
var init_contracts = __esm({
  "src/contracts.ts"() {
    "use strict";
    PACKAGE_NAME = "@qwqbig/dsh-archive-delete";
    SUPPORTED_DSH_VERSION = "0.2.1-rc.3";
    SUPPORTED_DSH_VERSIONS = [SUPPORTED_DSH_VERSION, "0.2.1-rc.5"];
    SUPPORTED_DSH_VERSION_LABEL = SUPPORTED_DSH_VERSIONS.join(" / ");
    ArchiveError = class extends Error {
      constructor(code2, message) {
        super(message);
        this.code = code2;
        this.name = "ArchiveError";
      }
    };
  }
});

// src/filesystem.ts
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep, win32 } from "node:path";
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
var init_filesystem = __esm({
  "src/filesystem.ts"() {
    "use strict";
    init_contracts();
  }
});

// src/version.ts
import { createRequire } from "node:module";
var PLUGIN_VERSION;
var init_version = __esm({
  "src/version.ts"() {
    "use strict";
    PLUGIN_VERSION = createRequire(import.meta.url)("../package.json").version;
  }
});

// src/host-manifest.ts
import { constants as constants2 } from "node:fs";
import { lstat as lstat2, readFile } from "node:fs/promises";
import { createRequire as createRequire2 } from "node:module";
import { resolve as resolve2 } from "node:path";
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
function plainEntry(stat, limit) {
  return stat.isFile() && !stat.isSymbolicLink() && stat.size >= 0n && stat.size <= BigInt(limit);
}
async function readHostManifest(path, limit = 1024 * 1024) {
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 8 * 1024 * 1024) throw new RangeError("Invalid host manifest size limit.");
  const normalized = resolve2(path);
  const archive = archivePath(normalized);
  if (!archive) return readBoundedJson(path, limit);
  const physical = createRequire2(import.meta.url)("original-fs").promises;
  const before = await physical.lstat(archive, { bigint: true });
  if (!plainArchive(before)) throw invalid();
  const handle = await physical.open(archive, constants2.O_RDONLY | (constants2.O_NOFOLLOW ?? 0));
  try {
    const held = await handle.stat({ bigint: true });
    const current = await physical.lstat(archive, { bigint: true });
    if (!plainArchive(held) || !plainArchive(current) || signature(before) !== signature(held) || signature(before) !== signature(current)) throw changed();
    const entry = await lstat2(normalized, { bigint: true });
    if (!plainEntry(entry, limit)) throw invalid();
    const bytes = await readFile(normalized);
    const afterEntry = await lstat2(normalized, { bigint: true });
    const afterArchive = await physical.lstat(archive, { bigint: true });
    const afterHeld = await handle.stat({ bigint: true });
    if (!plainEntry(afterEntry, limit) || bytes.byteLength > limit || BigInt(bytes.byteLength) !== entry.size || entrySignature(entry) !== entrySignature(afterEntry) || !plainArchive(afterArchive) || !plainArchive(afterHeld) || signature(before) !== signature(afterArchive) || signature(before) !== signature(afterHeld)) throw changed();
    try {
      return JSON.parse(bytes.toString("utf8"));
    } catch {
      throw invalid();
    }
  } finally {
    await handle.close();
  }
}
var MAX_ARCHIVE_BYTES, signature, entrySignature;
var init_host_manifest = __esm({
  "src/host-manifest.ts"() {
    "use strict";
    init_contracts();
    init_filesystem();
    MAX_ARCHIVE_BYTES = 1024n * 1024n * 1024n;
    signature = (stat) => `${stat.dev}:${stat.ino}:${stat.mode}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
    entrySignature = (stat) => `${stat.mode}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
  }
});

// src/doctor.ts
var doctor_exports = {};
__export(doctor_exports, {
  formatDoctorReport: () => formatDoctorReport,
  runDoctor: () => runDoctor
});
import { constants as constants3 } from "node:fs";
import { access, lstat as lstat3 } from "node:fs/promises";
import { createRequire as createRequire3 } from "node:module";
import { dirname, isAbsolute as isAbsolute2, join } from "node:path";
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function code(error) {
  return record(error) && typeof error.code === "string" ? error.code : void 0;
}
async function manifest(path) {
  const data = await readBoundedJson(path, 1024 * 1024);
  if (!record(data)) throw new Error("invalid manifest");
  return data;
}
async function hostCodeManifest(path) {
  const data = await readHostManifest(path);
  if (!record(data)) throw new Error("invalid host manifest");
  return data;
}
function version(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}
async function runDoctor(options) {
  const language2 = options.language ?? "en";
  const text2 = (en, zh) => language2 === "zh" ? zh : en;
  const profile = options.profile ?? "desktop";
  if (!isAbsolute2(options.home)) throw new Error(text2("--home must be an absolute path.", "--home \u5FC5\u987B\u662F\u7EDD\u5BF9\u8DEF\u5F84\u3002"));
  if (!profile || profile.length > 255 || /[/\\\0]/.test(profile) || [".", "..", "node_modules"].includes(profile))
    throw new Error(text2("--profile must name one profile, without path separators.", "--profile \u5FC5\u987B\u4E3A\u5355\u4E2A profile \u540D\u79F0\uFF0C\u4E0D\u5F97\u5305\u542B\u8DEF\u5F84\u5206\u9694\u7B26\u3002"));
  if (options.runtimeRoot !== void 0 && !isAbsolute2(options.runtimeRoot))
    throw new Error(text2("--runtime must be an absolute runtime directory.", "--runtime \u5FC5\u987B\u4E3A\u8FD0\u884C\u65F6\u76EE\u5F55\u7684\u7EDD\u5BF9\u8DEF\u5F84\u3002"));
  const profileDirectory = join(options.home, "profiles", profile);
  assertLocalStoragePath(options.home);
  assertLocalStoragePath(profileDirectory);
  const checks = [];
  const add = (id, status, problem, en, zh, path) => {
    checks.push({ id, status, code: problem, message: text2(en, zh), ...path ? { path } : {} });
  };
  const report = {
    schemaVersion: 1,
    ok: false,
    status: "warn",
    language: language2,
    plugin: { name: PACKAGE_NAME, version: PLUGIN_VERSION },
    home: options.home,
    profile: { name: profile, directory: profileDirectory },
    targetDshVersion: SUPPORTED_DSH_VERSION_LABEL,
    supportedDshVersions: [...SUPPORTED_DSH_VERSIONS],
    host: { version: "unknown", source: "unresolved" },
    runtimeState: "unverified",
    checks,
    note: text2(
      "This read-only check does not prove that DSH is running or has loaded this plugin. Fully quit and reopen the selected profile, then check its component status, loaded log, and management button.",
      "\u6B64\u53EA\u8BFB\u68C0\u67E5\u65E0\u6CD5\u8BC1\u660E DSH \u6B63\u5728\u8FD0\u884C\u6216\u5DF2\u52A0\u8F7D\u63D2\u4EF6\u3002\u8BF7\u5B8C\u5168\u9000\u51FA\u540E\u91CD\u65B0\u6253\u5F00\u6240\u9009 profile\uFF0C\u518D\u68C0\u67E5\u7EC4\u4EF6\u72B6\u6001\u3001\u52A0\u8F7D\u65E5\u5FD7\u548C\u7BA1\u7406\u6309\u94AE\u3002"
    )
  };
  add(
    "platform",
    ["darwin", "win32"].includes(process.platform) ? "pass" : "fail",
    "host-platform",
    `Platform: ${process.platform}. Supported targets are macOS and Windows Desktop.`,
    `\u5E73\u53F0\uFF1A${process.platform}\u3002\u652F\u6301 macOS \u548C Windows \u684C\u9762\u7AEF\u3002`
  );
  let selected;
  const profileManifest = join(profileDirectory, "package.json");
  try {
    await assertCanonicalStoragePath(options.home);
    await assertPlainDirectory(profileDirectory);
    await assertCanonicalStoragePath(profileDirectory);
    selected = await manifest(profileManifest);
    add("profile", "pass", "profile-readable", "The selected profile manifest is readable.", "\u6240\u9009 profile \u6E05\u5355\u53EF\u8BFB\u53D6\u3002", profileManifest);
  } catch (error) {
    add(
      "profile",
      "fail",
      code(error) === "ENOENT" ? "profile-missing" : "profile-unreadable",
      "The selected profile is missing, unsafe, or its package.json is invalid. Check --home and --profile; no profile was created or changed.",
      "\u6240\u9009 profile \u4E0D\u5B58\u5728\u3001\u8DEF\u5F84\u4E0D\u5B89\u5168\u6216 package.json \u65E0\u6548\u3002\u8BF7\u68C0\u67E5 --home \u548C --profile\uFF1B\u672A\u521B\u5EFA\u6216\u4FEE\u6539\u4EFB\u4F55 profile\u3002",
      profileManifest
    );
  }
  const dsh = selected && record(selected.dsh) ? selected.dsh : void 0;
  const settings = dsh && record(dsh.profile) ? dsh.profile : void 0;
  const bundles = settings?.bundles;
  if (!Array.isArray(bundles) || !bundles.every((item) => typeof item === "string")) {
    add(
      "bundle-registration",
      "fail",
      "bundle-list-invalid",
      "The profile has no valid dsh.profile.bundles array. Repair its configuration before enabling this plugin.",
      "profile \u4E2D\u6CA1\u6709\u6709\u6548\u7684 dsh.profile.bundles \u6570\u7EC4\u3002\u8BF7\u5148\u4FEE\u590D\u914D\u7F6E\uFF0C\u518D\u542F\u7528\u63D2\u4EF6\u3002",
      profileManifest
    );
  } else if (!bundles.includes(PACKAGE_NAME)) {
    add(
      "bundle-registration",
      "fail",
      "bundle-not-registered",
      "The plugin bundle is not registered in this profile. Enable it through the plugin manager, or add its name once while preserving existing entries.",
      "\u63D2\u4EF6 bundle \u5C1A\u672A\u767B\u8BB0\u5728\u6B64 profile\u3002\u8BF7\u901A\u8FC7\u63D2\u4EF6\u7BA1\u7406\u5668\u542F\u7528\uFF0C\u6216\u4FDD\u7559\u5DF2\u6709\u6761\u76EE\u5E76\u8865\u5165\u4E00\u6B21\u63D2\u4EF6\u5305\u540D\u3002",
      profileManifest
    );
  } else if (bundles.filter((item) => item === PACKAGE_NAME).length !== 1) {
    add(
      "bundle-registration",
      "warn",
      "bundle-duplicated",
      "The plugin bundle appears more than once. Fully quit DSH and remove only duplicate copies of this package name.",
      "\u63D2\u4EF6 bundle \u91CD\u590D\u767B\u8BB0\u3002\u8BF7\u5B8C\u5168\u9000\u51FA DSH\uFF0C\u4EC5\u5220\u9664\u6B64\u5305\u540D\u7684\u91CD\u590D\u6761\u76EE\u3002",
      profileManifest
    );
  } else add("bundle-registration", "pass", "bundle-registered", "The plugin bundle is registered once in the selected profile.", "\u63D2\u4EF6 bundle \u5DF2\u5728\u6240\u9009 profile \u4E2D\u767B\u8BB0\u4E00\u6B21\u3002", profileManifest);
  try {
    const pluginManifest = createRequire3(profileManifest).resolve(`${PACKAGE_NAME}/package.json`);
    const installed = await manifest(pluginManifest);
    if (installed.name !== PACKAGE_NAME || !version(installed.version)) throw new Error("unexpected package");
    report.plugin.installedVersion = installed.version;
    const directory = dirname(pluginManifest);
    const artifacts = ["lib/index.js", "lib/client.js", "cordis.patch.yml"];
    if (installed.version === PLUGIN_VERSION) artifacts.push("lib/doctor.js");
    for (const filename of artifacts) {
      const stat = await lstat3(join(directory, filename));
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("invalid package artifact");
    }
    add(
      "installation",
      installed.version === PLUGIN_VERSION ? "pass" : "warn",
      installed.version === PLUGIN_VERSION ? "package-installed" : "doctor-version-differs",
      installed.version === PLUGIN_VERSION ? `Installed package ${installed.version} contains its precompiled artifacts.` : `Installed package ${installed.version} differs from this doctor ${PLUGIN_VERSION}. Run the doctor shipped with that installation.`,
      installed.version === PLUGIN_VERSION ? `\u5DF2\u5B89\u88C5\u7684 ${installed.version} \u5305\u542B\u9884\u7F16\u8BD1\u4EA7\u7269\u3002` : `\u5DF2\u5B89\u88C5\u7684 ${installed.version} \u4E0E\u5F53\u524D\u81EA\u68C0\u5DE5\u5177 ${PLUGIN_VERSION} \u4E0D\u4E00\u81F4\u3002\u8BF7\u4F7F\u7528\u8BE5\u5B89\u88C5\u5305\u81EA\u5E26\u7684\u81EA\u68C0\u5DE5\u5177\u3002`,
      pluginManifest
    );
  } catch {
    add(
      "installation",
      "fail",
      "package-missing-or-incomplete",
      "The plugin package is missing, unresolved, or incomplete. Install the release asset into this profile; a stale bundle entry alone cannot load it.",
      "\u63D2\u4EF6\u5305\u4E0D\u5B58\u5728\u3001\u65E0\u6CD5\u89E3\u6790\u6216\u4E0D\u5B8C\u6574\u3002\u8BF7\u5C06 Release \u5B89\u88C5\u5305\u5B89\u88C5\u5230\u6B64 profile\uFF1B\u53EA\u6709\u6B8B\u7559\u7684 bundle \u6761\u76EE\u65E0\u6CD5\u52A0\u8F7D\u63D2\u4EF6\u3002",
      profileDirectory
    );
  }
  try {
    let hostManifest;
    if (options.runtimeRoot !== void 0) {
      assertLocalStoragePath(options.runtimeRoot);
      const direct = join(options.runtimeRoot, "package.json");
      let directManifest;
      try {
        directManifest = await hostCodeManifest(direct);
      } catch (error) {
        if (code(error) !== "ENOENT") throw error;
      }
      hostManifest = directManifest?.name === "@deepseek-ai/dsh" ? direct : join(options.runtimeRoot, "node_modules", "@deepseek-ai", "dsh", "package.json");
      report.host.source = "explicit-runtime";
    } else {
      hostManifest = createRequire3(profileManifest).resolve("@deepseek-ai/dsh/package.json");
      report.host.source = "profile-resolution";
    }
    const installed = await hostCodeManifest(hostManifest);
    if (installed.name !== "@deepseek-ai/dsh" || !version(installed.version)) throw new Error("unexpected host");
    report.host.manifest = hostManifest;
    report.host.version = installed.version;
    const match = isSupportedDshVersion(installed.version);
    add(
      "host-version",
      match ? "pass" : "fail",
      match ? "host-version-matches" : "host-version-mismatch",
      `Selected runtime: DSH ${installed.version}; supported: ${SUPPORTED_DSH_VERSION_LABEL}.${match ? " This does not identify a running process." : " Install a supported DSH Desktop version, then fully quit and reopen it."}`,
      `\u6240\u9009\u8FD0\u884C\u65F6\uFF1ADSH ${installed.version}\uFF1B\u652F\u6301\uFF1A${SUPPORTED_DSH_VERSION_LABEL}\u3002${match ? "\u6B64\u7ED3\u679C\u4E0D\u4EE3\u8868\u5DF2\u8BC6\u522B\u6B63\u5728\u8FD0\u884C\u7684\u8FDB\u7A0B\u3002" : "\u8BF7\u4F7F\u7528\u652F\u6301\u7684 DSH \u684C\u9762\u7AEF\u7248\u672C\uFF0C\u7136\u540E\u5B8C\u5168\u9000\u51FA\u5E76\u91CD\u65B0\u6253\u5F00\u3002"}`,
      hostManifest
    );
  } catch {
    report.host.source = "unresolved";
    add(
      "host-version",
      options.runtimeRoot === void 0 ? "warn" : "fail",
      "host-runtime-unresolved",
      options.runtimeRoot === void 0 ? "The host runtime cannot be identified from this profile. Pass --runtime with the installation directory used by DSH; plugin peer dependencies are not host-version evidence." : "The explicit runtime does not contain a readable @deepseek-ai/dsh manifest. Check --runtime; no runtime was installed or changed.",
      options.runtimeRoot === void 0 ? "\u65E0\u6CD5\u4ECE\u6B64 profile \u786E\u8BA4\u5BBF\u4E3B\u8FD0\u884C\u65F6\u3002\u8BF7\u901A\u8FC7 --runtime \u6307\u5B9A DSH \u5B9E\u9645\u4F7F\u7528\u7684\u5B89\u88C5\u76EE\u5F55\uFF1B\u63D2\u4EF6\u7684 peer \u4F9D\u8D56\u4E0D\u80FD\u4F5C\u4E3A\u5BBF\u4E3B\u7248\u672C\u8BC1\u636E\u3002" : "\u6307\u5B9A\u8FD0\u884C\u65F6\u6CA1\u6709\u53EF\u8BFB\u53D6\u7684 @deepseek-ai/dsh \u6E05\u5355\u3002\u8BF7\u68C0\u67E5 --runtime\uFF1B\u672A\u5B89\u88C5\u6216\u4FEE\u6539\u8FD0\u884C\u65F6\u3002",
      options.runtimeRoot
    );
  }
  const archiveRoot = join(options.home, "archive-delete");
  let storageSafe = false;
  try {
    await assertPrivateDirectory(archiveRoot);
    await assertCanonicalStoragePath(archiveRoot);
    storageSafe = true;
    const missing = [];
    for (const area of ["trash", "staging", "receipts", "operations"]) {
      const path = join(archiveRoot, area);
      try {
        await assertPrivateDirectory(path);
        await assertCanonicalStoragePath(path);
      } catch (error) {
        if (code(error) === "ENOENT") missing.push(area);
        else throw error;
      }
    }
    add(
      "storage",
      missing.length ? "warn" : "pass",
      missing.length ? "storage-not-initialized" : "storage-layout-ready",
      missing.length ? `Storage is not fully initialized; missing: ${missing.join(", ")}. Start the supported host with this profile.` : "All four plugin storage directories are present and safe. Their presence is not proof of live loading.",
      missing.length ? `\u5B58\u50A8\u5C1A\u672A\u5B8C\u5168\u521D\u59CB\u5316\uFF0C\u7F3A\u5C11\uFF1A${missing.join("\u3001")}\u3002\u8BF7\u7528\u6B64 profile \u542F\u52A8\u53D7\u652F\u6301\u7684\u5BBF\u4E3B\u3002` : "\u56DB\u4E2A\u63D2\u4EF6\u5B58\u50A8\u76EE\u5F55\u5747\u5B58\u5728\u4E14\u5B89\u5168\u3002\u76EE\u5F55\u5B58\u5728\u4E0D\u4EE3\u8868\u5F53\u524D\u5DF2\u52A0\u8F7D\u63D2\u4EF6\u3002",
      archiveRoot
    );
  } catch (error) {
    storageSafe = false;
    add(
      "storage",
      code(error) === "ENOENT" ? "warn" : "fail",
      code(error) === "ENOENT" ? "storage-not-initialized" : "storage-unsafe",
      code(error) === "ENOENT" ? "Plugin storage has not been initialized. Fully quit and reopen DSH with the selected profile; no directories were created by this check." : "Plugin storage is unsafe or inaccessible. Retain its data and inspect permissions and canonical paths before retrying.",
      code(error) === "ENOENT" ? "\u63D2\u4EF6\u5B58\u50A8\u5C1A\u672A\u521D\u59CB\u5316\u3002\u8BF7\u5B8C\u5168\u9000\u51FA\u5E76\u7528\u6240\u9009 profile \u91CD\u65B0\u6253\u5F00 DSH\uFF1B\u6B64\u68C0\u67E5\u672A\u521B\u5EFA\u4EFB\u4F55\u76EE\u5F55\u3002" : "\u63D2\u4EF6\u5B58\u50A8\u4E0D\u5B89\u5168\u6216\u65E0\u6CD5\u8BBF\u95EE\u3002\u8BF7\u4FDD\u7559\u6570\u636E\uFF0C\u6838\u5BF9\u6743\u9650\u4E0E\u89C4\u8303\u8DEF\u5F84\u540E\u91CD\u8BD5\u3002",
      archiveRoot
    );
  }
  const trash = join(archiveRoot, "trash");
  if (storageSafe) {
    try {
      await assertPrivateDirectory(trash);
      await assertCanonicalStoragePath(trash);
      await access(trash, constants3.W_OK);
      add(
        "trash-writable",
        "pass",
        "trash-access-passed",
        "The current process passes the trash write-access check. No probe file was created; a later operation can still fail.",
        "\u5F53\u524D\u8FDB\u7A0B\u901A\u8FC7\u56DE\u6536\u7AD9\u5199\u5165\u6743\u9650\u68C0\u67E5\u3002\u672A\u521B\u5EFA\u63A2\u6D4B\u6587\u4EF6\uFF0C\u540E\u7EED\u5B9E\u9645\u64CD\u4F5C\u4ECD\u53EF\u80FD\u5931\u8D25\u3002",
        trash
      );
    } catch (error) {
      add(
        "trash-writable",
        code(error) === "ENOENT" ? "warn" : "fail",
        code(error) === "ENOENT" ? "trash-not-initialized" : "trash-not-writable",
        code(error) === "ENOENT" ? "Trash is not initialized yet; start the supported host with this profile." : "Trash write access is unavailable or unsafe. Check permissions without deleting recovery data.",
        code(error) === "ENOENT" ? "\u56DE\u6536\u7AD9\u5C1A\u672A\u521D\u59CB\u5316\uFF0C\u8BF7\u7528\u6B64 profile \u542F\u52A8\u53D7\u652F\u6301\u7684\u5BBF\u4E3B\u3002" : "\u56DE\u6536\u7AD9\u4E0D\u53EF\u5B89\u5168\u5199\u5165\u3002\u8BF7\u68C0\u67E5\u6743\u9650\uFF0C\u4FDD\u7559\u6062\u590D\u6570\u636E\u3002",
        trash
      );
    }
  } else add("trash-writable", "warn", "trash-access-not-checked", "Write access was not checked because plugin storage is absent or unsafe.", "\u63D2\u4EF6\u5B58\u50A8\u4E0D\u5B58\u5728\u6216\u4E0D\u5B89\u5168\uFF0C\u56E0\u6B64\u672A\u68C0\u67E5\u5199\u5165\u6743\u9650\u3002", trash);
  report.status = checks.some((check) => check.status === "fail") ? "fail" : checks.some((check) => check.status === "warn") ? "warn" : "pass";
  report.ok = report.status === "pass";
  return report;
}
function formatDoctorReport(report) {
  const zh = report.language === "zh";
  const lines = [
    `${PACKAGE_NAME} ${report.plugin.version} \xB7 ${zh ? "\u53EA\u8BFB\u81EA\u68C0" : "read-only doctor"}`,
    `${zh ? "\u6240\u9009 profile" : "Selected profile"}: ${report.profile.name} (${report.profile.directory})`,
    ...report.checks.map((check) => `[${check.status.toUpperCase()}] ${check.id}: ${check.message}${check.path ? `
  ${check.path}` : ""}`),
    "",
    report.note
  ];
  return lines.join("\n") + "\n";
}
var init_doctor = __esm({
  "src/doctor.ts"() {
    "use strict";
    init_contracts();
    init_filesystem();
    init_version();
    init_host_manifest();
  }
});

// src/doctor-cli.ts
import { homedir } from "node:os";
import { join as join2 } from "node:path";
var args = process.argv.slice(2);
var explicitLanguage = args[args.indexOf("--lang") + 1];
var language = explicitLanguage === "zh" || !args.includes("--lang") && /^zh(?:[-_.]|$)/i.test(process.env.LC_ALL ?? process.env.LC_MESSAGES ?? process.env.LANG ?? Intl.DateTimeFormat().resolvedOptions().locale) ? "zh" : "en";
var text = (en, zh) => language === "zh" ? zh : en;
var help = text(`Usage: dsh-archive-delete-doctor [options]
  --home PATH      Absolute DSH home (default: DSH_HOME or ~/.dsh)
  --profile NAME   Profile to inspect (default: desktop)
  --runtime PATH   Actual DSH runtime directory (or DSH_RUNTIME_ROOT)
  --lang en|zh     Output language
  --json           Structured JSON output
  --help           Show help without inspecting a profile

Requires Node 24+. This is read-only configuration and access checking.
It cannot prove that a running DSH process loaded the plugin.
Exit 0: all static checks passed; 1: failed or incomplete checks; 2: usage error.
`, `\u7528\u6CD5\uFF1Adsh-archive-delete-doctor [\u9009\u9879]
  --home PATH      DSH home \u7EDD\u5BF9\u8DEF\u5F84\uFF08\u9ED8\u8BA4 DSH_HOME \u6216 ~/.dsh\uFF09
  --profile NAME   \u68C0\u67E5\u7684 profile\uFF08\u9ED8\u8BA4 desktop\uFF09
  --runtime PATH   DSH \u5B9E\u9645\u8FD0\u884C\u65F6\u76EE\u5F55\uFF08\u6216 DSH_RUNTIME_ROOT\uFF09
  --lang en|zh     \u8F93\u51FA\u8BED\u8A00
  --json           \u8F93\u51FA\u7ED3\u6784\u5316 JSON
  --help           \u663E\u793A\u5E2E\u52A9\uFF0C\u4E0D\u68C0\u67E5 profile

\u9700\u8981 Node 24+\u3002\u4EC5\u53EA\u8BFB\u6838\u5BF9\u914D\u7F6E\u4E0E\u8BBF\u95EE\u6743\u9650\uFF0C\u65E0\u6CD5\u8BC1\u660E\u6B63\u5728\u8FD0\u884C\u7684 DSH \u5DF2\u52A0\u8F7D\u63D2\u4EF6\u3002
\u9000\u51FA\u7801 0\uFF1A\u9759\u6001\u68C0\u67E5\u5168\u90E8\u901A\u8FC7\uFF1B1\uFF1A\u68C0\u67E5\u5931\u8D25\u6216\u4E0D\u5B8C\u6574\uFF1B2\uFF1A\u7528\u6CD5\u9519\u8BEF\u3002
`);
async function main() {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(help);
    return;
  }
  try {
    const values = /* @__PURE__ */ new Map();
    let json = false;
    for (let i = 0; i < args.length; i++) {
      const key = args[i];
      if (key === "--json" && !json) {
        json = true;
        continue;
      }
      if (!["--home", "--profile", "--runtime", "--lang"].includes(key) || values.has(key)) throw new Error(text(`Unknown or duplicate option: ${key}`, `\u672A\u77E5\u6216\u91CD\u590D\u7684\u9009\u9879\uFF1A${key}`));
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(text(`Missing value for ${key}`, `${key} \u7F3A\u5C11\u53C2\u6570`));
      values.set(key, value);
    }
    if (values.has("--lang") && !["en", "zh"].includes(values.get("--lang"))) throw new Error(text("--lang must be en or zh.", "--lang \u5FC5\u987B\u4E3A en \u6216 zh\u3002"));
    if (Number(process.versions.node.split(".")[0]) < 24) throw new Error(text(`Node 24+ is required; current Node is ${process.versions.node}.`, `\u9700\u8981 Node 24+\uFF0C\u5F53\u524D\u4E3A ${process.versions.node}\u3002`));
    const { runDoctor: runDoctor2, formatDoctorReport: formatDoctorReport2 } = await Promise.resolve().then(() => (init_doctor(), doctor_exports));
    const runtimeRoot = values.get("--runtime") ?? process.env.DSH_RUNTIME_ROOT?.trim();
    const report = await runDoctor2({
      home: values.get("--home") ?? (process.env.DSH_HOME?.trim() || join2(homedir(), ".dsh")),
      profile: values.get("--profile") ?? "desktop",
      language,
      ...runtimeRoot ? { runtimeRoot } : {}
    });
    process.stdout.write(json ? JSON.stringify(report, null, 2) + "\n" : formatDoctorReport2(report));
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (args.includes("--json")) process.stdout.write(JSON.stringify({ ok: false, error: { code: "doctor-usage", message } }) + "\n");
    else process.stderr.write(`${message}
${text("Use --help for usage.", "\u8BF7\u4F7F\u7528 --help \u67E5\u770B\u7528\u6CD5\u3002")}
`);
    process.exitCode = 2;
  }
}
await main();
