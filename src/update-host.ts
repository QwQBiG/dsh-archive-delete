import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { createRequire } from 'node:module';
import { lstat, open, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ArchiveError, PACKAGE_NAME, SUPPORTED_DSH_VERSION } from './contracts.js';
import type { HostContext } from './dsh-adapter.js';
import { assertCanonicalStoragePath, assertLocalStoragePath, assertPrivateDirectory, isWithin, readBoundedJson, samePath } from './filesystem.js';
import { PLUGIN_VERSION } from './version.js';
import type { HostUpdateResult, InstalledUpdateTarget, UpdateHost } from './update-host-types.js';
import { validateUpdatePackage } from './update-source.js';

interface Profile { name: string; dir: string; home: string; installAnchor: string }
interface Manager {
  profile: Profile;
  listBundles(): Promise<unknown>;
  installBundle(path: string, options: { requestId: string; saveExact: true; enabled: true }): Promise<unknown>;
}
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function get(ctx: HostContext, name: string): unknown { try { return ctx.get?.(name) ?? ctx[name]; } catch { return undefined; } }
// rc.3 returns a fresh trace proxy for a service read. Compare its native
// original target so proxy allocation cannot look like a manager replacement.
function original(value: unknown): unknown {
  if (!object(value) && typeof value !== 'function') return value;
  try { return (value as Record<symbol, unknown>)[Symbol.for('cordis.original')] ?? value; } catch { return value; }
}
function profileOf(value: unknown): Profile | undefined {
  if (!object(value) || !['name', 'dir', 'home', 'installAnchor'].every(key => typeof value[key] === 'string')) return undefined;
  const profile = value as unknown as Profile;
  if (!profile.name || /[/\\\0]/.test(profile.name) || ['.', '..', 'node_modules'].includes(profile.name)) return undefined;
  if (![profile.dir, profile.home, profile.installAnchor].every(path => isAbsolute(path) && !path.includes('\0'))
    || !samePath(profile.dir, join(profile.home, 'profiles', profile.name))) return undefined;
  return profile;
}
function sameProfile(left: Profile, right: Profile): boolean {
  return left.name === right.name && ['dir', 'home', 'installAnchor'].every(key => samePath(left[key as keyof Profile], right[key as keyof Profile]));
}
const unavailable = () => new ArchiveError('update-host-unavailable', 'The current profile does not provide a supported native plugin update capability.');
const invalidTarget = () => new ArchiveError('update-target-invalid', 'This plugin is not an unambiguous profile-owned installation.');

/** Resolves only the live profile's exact rc.3 manager; no package runner or unload is replaced. */
export async function createUpdateHost(ctx: HostContext): Promise<UpdateHost> {
  const suppliedProfile = profileOf(get(ctx, 'profileContext'));
  const profile = suppliedProfile ? { name: suppliedProfile.name, dir: suppliedProfile.dir, home: suppliedProfile.home, installAnchor: suppliedProfile.installAnchor } : undefined;
  let hostVersion = 'unknown'; let manager: Manager | undefined;
  try {
    if (!profile) throw unavailable();
    const manifest = await readBoundedJson(profile.installAnchor);
    if (!object(manifest) || manifest.name !== '@deepseek-ai/dsh' || typeof manifest.version !== 'string') throw unavailable();
    hostVersion = manifest.version;
    if (hostVersion !== SUPPORTED_DSH_VERSION || (object(manifest.dependencies) && Object.hasOwn(manifest.dependencies, PACKAGE_NAME))) throw unavailable();
    const nativeRequire = createRequire(profile.installAnchor);
    const managerFile = nativeRequire.resolve('@deepseek-ai/dsh-plugin-manager');
    const managerManifest = await readBoundedJson(join(dirname(managerFile), '..', 'package.json'));
    if (!object(managerManifest) || managerManifest.name !== '@deepseek-ai/dsh-plugin-manager' || managerManifest.version !== SUPPORTED_DSH_VERSION) throw unavailable();
    const native = await import(pathToFileURL(managerFile).href) as Record<string, unknown>;
    const found = original(get(ctx, 'pluginManager'));
    if (typeof native.PluginManager !== 'function' || !(found instanceof native.PluginManager)) throw unavailable();
    const candidate = found as Manager; const managerProfile = profileOf(candidate.profile);
    if (!managerProfile || !sameProfile(profile, managerProfile) || typeof candidate.installBundle !== 'function' || typeof candidate.listBundles !== 'function') throw unavailable();
    manager = candidate;
  } catch { /* Checks and update notices remain available without an install capability. */ }

  const installed = async (): Promise<InstalledUpdateTarget> => {
    if (!profile || !manager || hostVersion !== SUPPORTED_DSH_VERSION) throw unavailable();
    const current = profileOf(get(ctx, 'profileContext')); const owner = profileOf(manager.profile);
    if (!current || !owner || !sameProfile(profile, current) || !sameProfile(profile, owner) || original(get(ctx, 'pluginManager')) !== manager) throw unavailable();
    assertLocalStoragePath(profile.dir); assertLocalStoragePath(profile.home);
    const profileEntry = await lstat(profile.dir); const canonicalProfile = await realpath(profile.dir);
    if (!profileEntry.isDirectory() || profileEntry.isSymbolicLink() || !samePath(canonicalProfile, profile.dir)) throw invalidTarget();
    await assertCanonicalStoragePath(profile.dir, canonicalProfile);
    const manifest = await readBoundedJson(join(profile.dir, 'package.json'));
    if (!object(manifest) || !object(manifest.dependencies) || typeof manifest.dependencies[PACKAGE_NAME] !== 'string') throw invalidTarget();
    const source = manifest.dependencies[PACKAGE_NAME];
    if (!source || source.includes('\0')) throw invalidTarget();
    const packageDirectory = await realpath(join(profile.dir, 'node_modules', PACKAGE_NAME));
    if (!isWithin(join(canonicalProfile, 'node_modules'), packageDirectory)) throw invalidTarget();
    try {
      const installationCopy = await realpath(createRequire(profile.installAnchor).resolve(`${PACKAGE_NAME}/package.json`));
      if (!samePath(dirname(installationCopy), packageDirectory)) throw invalidTarget();
    } catch (error) {
      // Not resolvable from the installation is the normal external-bundle
      // case. An installation-owned or unreadable competing copy is refused.
      if (!object(error) || error.code !== 'MODULE_NOT_FOUND') throw error;
    }
    const target = await readBoundedJson(join(packageDirectory, 'package.json'));
    if (!object(target) || target.name !== PACKAGE_NAME || typeof target.version !== 'string' || !VERSION.test(target.version)
      || !object(target.dsh) || !object(target.dsh.bundle) || typeof target.dsh.bundle.patch !== 'string') throw invalidTarget();
    const rows = await manager.listBundles();
    const matches = Array.isArray(rows) ? rows.filter(row => object(row) && row.name === PACKAGE_NAME) : [];
    const row: unknown = matches[0];
    if (matches.length !== 1 || !object(row) || row.installed !== true || row.availability !== 'profile' || row.removable !== true
      || row.version !== target.version || typeof row.source !== 'string' || row.error !== undefined) throw invalidTarget();
    return { version: target.version, source };
  };
  let canInstall = manager !== undefined;
  if (canInstall) { try { await installed(); } catch { canInstall = false; } }
  let profileId = profile?.dir ?? 'unavailable';
  if (canInstall && profile) profileId = await realpath(profile.dir);
  if (process.platform === 'win32') profileId = profileId.toLowerCase();
  return { profileId, hostVersion, loadedVersion: PLUGIN_VERSION, canInstall, installed,
    install: async (packagePath, version, requestId): Promise<HostUpdateResult> => {
      if (!canInstall || !manager || !profile) return { status: 'failed', code: 'update-host-unavailable' };
      if (!VERSION.test(version) || !UUID.test(requestId)) return { status: 'failed', code: 'invalid-request' };
      try {
        await installed();
        const packages = join(profile.home, 'archive-delete', 'updates', 'packages');
        if (!isAbsolute(packagePath) || !samePath(dirname(packagePath), packages)
          || !new RegExp(`^${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-[a-f0-9]{64}\\.tgz$`).test(basename(packagePath)))
          return { status: 'failed', code: 'update-package-invalid' };
        for (const path of [profile.home, join(profile.home, 'archive-delete'), join(profile.home, 'archive-delete', 'updates'), packages]) {
          const entry = await lstat(path);
          if (!entry.isDirectory() || entry.isSymbolicLink() || !samePath(await realpath(path), resolve(path))) return { status: 'failed', code: 'update-package-invalid' };
          await assertCanonicalStoragePath(path);
          await assertPrivateDirectory(path);
        }
        const entry = await lstat(packagePath);
        if (!entry.isFile() || entry.isSymbolicLink() || !samePath(await realpath(packagePath), resolve(packagePath))) return { status: 'failed', code: 'update-package-invalid' };
        if (process.platform !== 'win32' && ((typeof process.getuid === 'function' && entry.uid !== process.getuid()) || (entry.mode & 0o022) !== 0))
          return { status: 'failed', code: 'update-package-invalid' };
        if (entry.size > 16 * 1024 * 1024) return { status: 'failed', code: 'update-package-invalid' };
        const handle = await open(packagePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
          const held = await handle.stat({ bigint: true }); const before = await lstat(packagePath, { bigint: true });
          if (!held.isFile() || before.isSymbolicLink() || held.size > 16n * 1024n * 1024n || held.dev !== before.dev || held.ino !== before.ino) return { status: 'failed', code: 'update-package-invalid' };
          const bytes = Buffer.alloc(Number(held.size)); let offset = 0;
          while (offset < bytes.length) {
            const read = await handle.read(bytes, offset, bytes.length - offset, offset);
            if (read.bytesRead === 0) break;
            offset += read.bytesRead;
          }
          const overflow = await handle.read(Buffer.alloc(1), 0, 1, offset);
          const after = await lstat(packagePath, { bigint: true });
          if (offset !== bytes.length || overflow.bytesRead !== 0 || after.isSymbolicLink() || after.dev !== held.dev || after.ino !== held.ino
            || after.size !== held.size || after.mtimeNs !== held.mtimeNs || after.ctimeNs !== held.ctimeNs
            || basename(packagePath) !== `${version}-${createHash('sha256').update(bytes).digest('hex')}.tgz`)
            return { status: 'failed', code: 'update-package-invalid' };
          await validateUpdatePackage(bytes, version, hostVersion);
        } finally { await handle.close(); }
      } catch { return { status: 'failed', code: 'update-target-invalid' }; }
      let result: unknown;
      try { result = await manager.installBundle(packagePath, { requestId, saveExact: true, enabled: true }); }
      catch { return { status: 'unknown', code: 'update-install-unknown' }; }
      if (!object(result)) return { status: 'unknown', code: 'update-install-unknown' };
      if (object(result.error)) return { status: 'failed', code: typeof result.error.code === 'string' ? result.error.code : 'update-install-failed' };
      if (result.application === 'failed' || result.application === 'cancelled') return { status: 'failed', code: 'update-install-failed' };
      if (Array.isArray(result.pendingBuilds) && result.pendingBuilds.length) return { status: 'failed', code: 'update-build-approval-required' };
      if (object(result.packageResult) && (result.packageResult.exitCode !== 0 || result.packageResult.timedOut === true)) return { status: 'failed', code: 'update-install-failed' };
      if (!['applied', 'restart-required'].includes(String(result.application)) || result.bundle !== PACKAGE_NAME || result.version !== version)
        return { status: 'unknown', code: 'update-install-unknown' };
      try {
        const after = await installed();
        const source = after.source.replace(/^file:/, '');
        if (after.version !== version || !samePath(resolve(profile.dir, source), packagePath)) return { status: 'unknown', code: 'update-install-mismatch' };
      } catch { return { status: 'unknown', code: 'update-install-mismatch' }; }
      return { status: result.application === 'restart-required' ? 'restart-required' : 'installed' };
    } };
}
