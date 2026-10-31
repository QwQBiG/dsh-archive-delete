import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ArchiveError } from './contracts.js';
import { assertPrivateDirectory, readBoundedJson, syncDirectory } from './filesystem.js';
import type { UpdateCandidate, UpdateInstallation, UpdateOverview } from './update-contracts.js';
import type { UpdateHost } from './update-host-types.js';
import type { ReleaseCheck, UpdateSource } from './update-source-types.js';
import { UpdateRateLimitError } from './update-source-types.js';

const DAY = 24 * 60 * 60_000;
const RETRY = 60 * 60_000;
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const bounded = (value: unknown, maximum: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= maximum && !value.includes('\0');
const errorCode = (error: unknown): string => error instanceof ArchiveError && /^update-[a-z-]+$/.test(error.code) ? error.code : 'update-failed';
function candidate(value: unknown): value is UpdateCandidate {
  return record(value) && bounded(value.id, 512) && typeof value.version === 'string' && VERSION.test(value.version)
    && bounded(value.requiredDshVersion, 100) && bounded(value.publishedAt, 100)
    && value.releaseUrl === `https://github.com/QwQBiG/dsh-archive-delete/releases/tag/v${value.version}`
    && typeof value.notes === 'string' && value.notes.length <= 64_000
    && Number.isSafeInteger(value.assetBytes) && Number(value.assetBytes) > 0 && Number(value.assetBytes) <= 16 * 1024 * 1024;
}
interface SavedInstallation extends UpdateInstallation { candidateId: string; startedAt: number }
interface Cache { schema: 1; currentVersion: string; hostVersion: string; checkedAt: number; nextCheckAt: number; check: Omit<ReleaseCheck, 'pinned' | 'availability'> & { availability: UpdateOverview['availability'] } }
interface Options {
  root: string;
  host: UpdateHost;
  source: UpdateSource;
  beginUpdate(): Promise<(restartRequired?: boolean) => void>;
  now?(): number;
}

/** A small private update journal, independent of session recovery receipts. */
class UpdateStore {
  private readonly profileKey: string;
  constructor(readonly root: string, profileId: string) { this.profileKey = createHash('sha256').update(profileId).digest('hex'); }
  async initialize(): Promise<void> {
    await assertPrivateDirectory(this.root);
    for (const path of [this.area(), this.packages()]) {
      let created = false;
      try { await mkdir(path, { mode: 0o700 }); created = true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      await assertPrivateDirectory(path);
      if (created) await syncDirectory(dirname(path));
      for (const name of await readdir(path)) if (/^\.update-[a-f\d-]{36}\.tmp$/.test(name)) {
        const temporary = join(path, name); const st = await lstat(temporary);
        if (!st.isFile() || st.isSymbolicLink()) throw new ArchiveError('update-state-unsafe', 'A temporary update file is unsafe.');
        await unlink(temporary);
      }
    }
  }
  area(): string { return join(this.root, 'updates'); }
  packages(): string { return join(this.area(), 'packages'); }
  async read(name: 'check.json' | 'installation.json'): Promise<unknown> {
    await assertPrivateDirectory(this.area());
    try { return await readBoundedJson(join(this.area(), `${this.profileKey}.${name}`), 128 * 1024); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  }
  async write(name: 'check.json' | 'installation.json', value: unknown): Promise<void> {
    await assertPrivateDirectory(this.root); await assertPrivateDirectory(this.area());
    const target = join(this.area(), `${this.profileKey}.${name}`); const temporary = join(this.area(), `.update-${randomUUID()}.tmp`);
    try {
      try { const before = await lstat(target); if (!before.isFile() || before.isSymbolicLink()) throw new ArchiveError('update-state-unsafe', 'Update metadata is unsafe.'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
      try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, target); await syncDirectory(this.area());
    } finally { await unlink(temporary).catch(() => {}); }
  }
  async package(version: string, digest: string, bytes: Uint8Array): Promise<string> {
    if (!VERSION.test(version) || !/^[a-f\d]{64}$/.test(digest) || bytes.length > 16 * 1024 * 1024
      || createHash('sha256').update(bytes).digest('hex') !== digest) throw new ArchiveError('update-integrity', 'The release package failed its checksum.');
    await assertPrivateDirectory(this.root); await assertPrivateDirectory(this.area()); await assertPrivateDirectory(this.packages());
    const target = join(this.packages(), `${version}-${digest}.tgz`);
    const verifyExisting = async (): Promise<void> => {
      const before = await lstat(target, { bigint: true });
      if (!before.isFile() || before.isSymbolicLink() || before.size !== BigInt(bytes.length)) throw new ArchiveError('update-state-unsafe', 'A cached update package is unsafe.');
      const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const held = await handle.stat({ bigint: true }); const data = await handle.readFile(); const after = await lstat(target, { bigint: true });
        if (held.dev !== before.dev || held.ino !== before.ino || held.size !== before.size || held.mtimeNs !== before.mtimeNs
          || after.dev !== before.dev || after.ino !== before.ino || after.isSymbolicLink()
          || createHash('sha256').update(data).digest('hex') !== digest) throw new ArchiveError('update-integrity', 'The cached release package changed.');
      } finally { await handle.close(); }
    };
    try { await verifyExisting(); return target; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    // Exclusive publication never overwrites a previous confirmed archive.
    const temporary = join(this.packages(), `.update-${randomUUID()}.tmp`);
    try {
      const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      try { await link(temporary, target); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; await verifyExisting(); }
    } finally { await unlink(temporary).catch(() => {}); }
    await syncDirectory(this.packages()); await verifyExisting(); return target;
  }
}

/** Discovery is read-only and cached. Only a fresh explicit owner confirmation
 * can cross the native profile-management boundary. */
export class UpdateService {
  private readonly store: UpdateStore;
  private readonly now: () => number;
  private cache: Cache | undefined;
  private checkPromise: Promise<void> | undefined;
  private checkAbort: AbortController | undefined;
  private installAbort: AbortController | undefined;
  private installation: SavedInstallation | undefined;
  private installPromise: Promise<UpdateOverview> | undefined;
  private activeRequest: { requestId: string; candidateId: string } | undefined;
  private interval: ReturnType<typeof setInterval> | undefined;
  private closed = false;
  private installedVersion: string;
  constructor(private readonly options: Options) {
    this.store = new UpdateStore(options.root, options.host.profileId); this.now = options.now ?? Date.now;
    this.installedVersion = options.host.loadedVersion;
  }
  async initialize(): Promise<void> {
    await this.store.initialize();
    this.installedVersion = (await this.options.host.installed()).version;
    const cached = await this.store.read('check.json');
    if (record(cached) && cached.schema === 1 && cached.currentVersion === this.options.host.loadedVersion && cached.hostVersion === this.options.host.hostVersion
      && typeof cached.checkedAt === 'number' && Number.isSafeInteger(cached.checkedAt) && cached.checkedAt >= 0 && cached.checkedAt <= this.now()
      && typeof cached.nextCheckAt === 'number' && Number.isSafeInteger(cached.nextCheckAt) && cached.nextCheckAt >= cached.checkedAt && cached.nextCheckAt <= cached.checkedAt + 7 * DAY
      && record(cached.check) && ['current', 'available', 'incompatible', 'error'].includes(String(cached.check.availability))
      && (cached.check.code === undefined || /^update-[a-z-]+$/.test(String(cached.check.code)))
      && (cached.check.candidate === undefined || candidate(cached.check.candidate))) this.cache = cached as unknown as Cache;
    const saved = await this.store.read('installation.json');
    if (saved !== undefined) {
      if (!record(saved) || !UUID.test(String(saved.requestId)) || !bounded(saved.candidateId, 512) || !VERSION.test(String(saved.version))
        || typeof saved.startedAt !== 'number' || !Number.isSafeInteger(saved.startedAt) || saved.startedAt < 0
        || !['installing', 'installed', 'restart-required', 'failed', 'interrupted', 'unknown'].includes(String(saved.status)))
        throw new ArchiveError('update-state-unsafe', 'The saved update operation is invalid.');
      this.installation = saved as unknown as SavedInstallation;
      if (['installing', 'installed', 'restart-required', 'unknown'].includes(this.installation.status)) {
        this.installation = { ...this.installation, status: this.installedVersion === this.installation.version
          ? this.options.host.loadedVersion === this.installedVersion ? 'installed' : 'restart-required'
          : this.options.host.loadedVersion === this.installedVersion ? 'interrupted' : 'unknown' };
        if (this.installation.status === 'installed') delete this.installation.code;
        await this.store.write('installation.json', this.installation);
      }
    }
    if (this.installedVersion !== this.options.host.loadedVersion || ['restart-required', 'unknown'].includes(this.installation?.status ?? '')) {
      const release = await this.options.beginUpdate(); release(true);
    }
  }
  start(): void {
    if (this.closed || !this.options.host.canInstall || this.interval) return;
    void this.info().catch(() => {});
    this.interval = setInterval(() => { void this.info().catch(() => {}); }, RETRY);
    this.interval.unref();
  }
  private overview(): UpdateOverview {
    return { currentVersion: this.options.host.loadedVersion, installedVersion: this.installedVersion, hostVersion: this.options.host.hostVersion,
      availability: this.cache?.check.availability ?? 'unknown', canInstall: this.options.host.canInstall && !this.closed,
      ...(this.cache ? { checkedAt: this.cache.checkedAt, nextCheckAt: this.cache.nextCheckAt,
        ...(this.cache.check.candidate ? { candidate: this.cache.check.candidate } : {}), ...(this.cache.check.code ? { code: this.cache.check.code } : {}) } : {}),
      ...(this.installation ? { installation: { requestId: this.installation.requestId, version: this.installation.version, status: this.installation.status,
        ...(this.installation.code ? { code: this.installation.code } : {}) } } : {}) };
  }
  async info(force = false): Promise<UpdateOverview> {
    if (this.closed) throw new ArchiveError('update-stopping', 'The plugin is stopping.');
    if (!this.installPromise) await this.reconcileInstallation();
    if (this.installPromise || this.installedVersion !== this.options.host.loadedVersion) return this.overview();
    const due = !this.cache || this.now() >= this.cache.nextCheckAt;
    const rateLimited = this.cache?.check.code === 'update-rate-limited' && this.now() < this.cache.nextCheckAt;
    const manual = force && !rateLimited && (!this.cache || this.now() - this.cache.checkedAt >= 60_000);
    if (!this.checkPromise && (due || manual)) {
      const abort = new AbortController(); this.checkAbort = abort;
      const checking = (async () => {
        const checkedAt = this.now();
        try {
          const check = await this.options.source.check(abort.signal);
          this.cache = { schema: 1, currentVersion: this.options.host.loadedVersion, hostVersion: this.options.host.hostVersion,
            checkedAt, nextCheckAt: checkedAt + DAY, check: { availability: check.availability,
              ...(check.candidate ? { candidate: check.candidate } : {}), ...(check.code ? { code: check.code } : {}) } };
          await this.store.write('check.json', this.cache);
        } catch (error) {
          if (abort.signal.aborted && this.closed) return;
          // Keep the previous candidate visible, but explicitly mark the failed
          // observation rather than claiming it is current.
          this.cache = { schema: 1, currentVersion: this.options.host.loadedVersion, hostVersion: this.options.host.hostVersion,
            checkedAt, nextCheckAt: Math.max(checkedAt + RETRY, error instanceof UpdateRateLimitError ? Math.min(checkedAt + 7 * DAY, error.retryAt) : 0), check: { availability: 'error', code: errorCode(error),
              ...(this.cache?.check.candidate ? { candidate: this.cache.check.candidate } : {}) } };
          await this.store.write('check.json', this.cache).catch(() => {});
        }
      })();
      this.checkPromise = checking;
      void checking.finally(() => { if (this.checkPromise === checking) { this.checkPromise = undefined; this.checkAbort = undefined; } }).catch(() => {});
    }
    await this.checkPromise;
    return this.overview();
  }
  async install(candidateId: string, requestId: string): Promise<UpdateOverview> {
    if (!UUID.test(requestId) || !bounded(candidateId, 512)) throw new ArchiveError('invalid-request', 'A valid update confirmation is required.');
    if (this.activeRequest?.requestId === requestId) {
      if (this.activeRequest.candidateId !== candidateId) throw new ArchiveError('update-request-conflict', 'This request belongs to a different update.');
      return this.installPromise!;
    }
    if (this.installation?.requestId === requestId) {
      if (this.installation.candidateId !== candidateId) throw new ArchiveError('update-request-conflict', 'This request belongs to a different update.');
      if (this.installPromise) return this.installPromise;
      if (this.closed) throw new ArchiveError('update-stopping', 'The plugin is stopping.');
      await this.reconcileInstallation();
      return this.overview();
    }
    if (this.closed || !this.options.host.canInstall) throw new ArchiveError('update-unavailable', 'The native plugin manager is unavailable.');
    if (this.installPromise || this.installedVersion !== this.options.host.loadedVersion
      || ['installing', 'restart-required', 'unknown'].includes(this.installation?.status ?? '')) throw new ArchiveError('update-in-progress', 'An update is already running or waiting for a restart.');
    if (this.cache?.check.availability !== 'available' || this.cache.check.candidate?.id !== candidateId)
      throw new ArchiveError('update-changed', 'Check updates again and review the current release.');
    const reviewed = this.cache.check.candidate;
    // Admission is synchronous: parallel confirmations cannot both download or
    // enter the native manager before the durable request exists.
    this.activeRequest = { requestId, candidateId };
    const task = this.runInstall(reviewed, candidateId, requestId);
    this.installPromise = task;
    void task.finally(() => { if (this.installPromise === task) { this.installPromise = undefined; this.activeRequest = undefined; } }).catch(() => {});
    return task;
  }
  /** A lost manager reply never authorizes a second installation. Re-read the
   * native profile to settle an already installed target; an old or unreadable
   * target alone cannot prove that a delegated package operation has stopped. */
  private async reconcileInstallation(): Promise<void> {
    const saved = this.installation;
    if (!saved || !['installing', 'unknown', 'restart-required'].includes(saved.status)) return;
    let installed: string;
    try { installed = (await this.options.host.installed()).version; }
    catch { return; }
    this.installedVersion = installed;
    if (installed !== saved.version || this.installation !== saved || this.installPromise) return;
    const status = installed === this.options.host.loadedVersion ? 'installed' : 'restart-required';
    if (saved.status === status && saved.code === undefined) return;
    this.installation = { ...saved, status };
    delete this.installation.code;
    await this.store.write('installation.json', this.installation);
  }
  private async runInstall(reviewed: UpdateCandidate, candidateId: string, requestId: string): Promise<UpdateOverview> {
    let release: ((restartRequired?: boolean) => void) | undefined;
    let managerCalled = false;
    const abort = new AbortController(); this.installAbort = abort;
    const budget = setTimeout(() => abort.abort(new ArchiveError('update-timeout', 'Update verification exceeded its time budget.')), 30_000);
    const checkStopped = () => {
      if (this.closed) throw new ArchiveError('update-stopping', 'The plugin stopped before installation.');
      if (abort.signal.aborted) throw new ArchiveError('update-timeout', 'Update verification exceeded its time budget.');
    };
    try {
      const checked = await this.options.source.check(abort.signal);
      checkStopped();
      if (checked.availability !== 'available' || checked.pinned?.candidate.id !== candidateId || checked.candidate?.version !== reviewed.version)
        throw new ArchiveError('update-changed', 'The release changed. Review a fresh update before installing.');
      await this.options.source.revalidate(checked.pinned, abort.signal);
      checkStopped();
      const bytes = await this.options.source.download(checked.pinned, abort.signal);
      checkStopped();
      const packagePath = await this.store.package(reviewed.version, checked.pinned.sha256, bytes);
      const installed = await this.options.host.installed();
      if (installed.version !== this.options.host.loadedVersion) throw new ArchiveError('update-restart-required', 'A different version is already installed. Restart DSH before continuing.');
      if (this.closed) throw new ArchiveError('update-stopping', 'The plugin stopped before installation.');
      release = await this.options.beginUpdate();
      if (this.closed) throw new ArchiveError('update-stopping', 'The plugin stopped before installation.');
      this.installation = { requestId, candidateId, version: reviewed.version, status: 'installing', startedAt: this.now() };
      await this.store.write('installation.json', this.installation);
      if (this.closed) throw new ArchiveError('update-stopping', 'The plugin stopped before installation.');
      checkStopped(); clearTimeout(budget);
      managerCalled = true;
      const result = await this.options.host.install(packagePath, reviewed.version, requestId);
      this.installedVersion = (await this.options.host.installed()).version;
      const status = this.installedVersion === reviewed.version
        ? result.status === 'installed' ? 'installed' : result.status === 'restart-required' ? 'restart-required' : 'unknown'
        : result.status === 'failed' && this.installedVersion === this.options.host.loadedVersion ? 'failed' : 'unknown';
      this.installation = { ...this.installation, status, ...(result.code ? { code: result.code } : {}) };
      await this.store.write('installation.json', this.installation);
      release(status === 'restart-required' || status === 'unknown' || this.installedVersion !== this.options.host.loadedVersion);
      release = undefined;
      return this.overview();
    } catch (error) {
      let changed = managerCalled;
      try { this.installedVersion = (await this.options.host.installed()).version; changed ||= this.installedVersion !== this.options.host.loadedVersion; } catch { /* Uncertain disk state stays protected. */ }
      if (this.installation?.requestId === requestId || managerCalled) {
        this.installation = { requestId, candidateId, version: reviewed.version, startedAt: this.installation?.startedAt ?? this.now(),
          status: changed ? 'unknown' : 'failed', code: errorCode(error) };
        await this.store.write('installation.json', this.installation);
      }
      release?.(changed); release = undefined;
      if (managerCalled) return this.overview();
      throw error;
    } finally { clearTimeout(budget); if (this.installAbort === abort) this.installAbort = undefined; release?.(true); }
  }
  async close(): Promise<void> {
    this.closed = true; if (this.interval) clearInterval(this.interval);
    this.checkAbort?.abort(); await this.checkPromise?.catch(() => {});
    this.installAbort?.abort();
    // The host owns an admitted installation. Awaiting it here would deadlock
    // self-replacement when HMR is already awaiting this plugin's disposal.
  }
}
