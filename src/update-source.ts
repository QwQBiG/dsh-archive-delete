import { createHash } from 'node:crypto';
import { gunzip } from 'node:zlib';
import { ArchiveError, PACKAGE_NAME } from './contracts.js';
import type { ReleaseUpdateMetadata, UpdateCandidate } from './update-contracts.js';
import type { PinnedUpdate, ReleaseCheck, UpdateSource } from './update-source-types.js';
import { UpdateRateLimitError } from './update-source-types.js';

const REPOSITORY = 'QwQBiG/dsh-archive-delete';
const API = `https://api.github.com/repos/${REPOSITORY}/releases`;
const WEB = `https://github.com/${REPOSITORY}/releases`;
const MAX = { releasesBytes: 1024 * 1024, metadataBytes: 32 * 1024, assetBytes: 16 * 1024 * 1024, expandedBytes: 64 * 1024 * 1024, tarEntries: 4096 };
const STABLE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const PEERS = new Set(['@deepseek-ai/cordis', '@deepseek-ai/dsh-app-boot', '@deepseek-ai/dsh-home-paths', '@deepseek-ai/node-addon-system', 'react']);
type Limits = typeof MAX;
export interface GithubUpdateSourceOptions {
  currentVersion: string; hostVersion: string; platform: string; fetch?: typeof globalThis.fetch;
  /** Test limits may only make the production limits stricter. */
  limits?: Partial<Limits>; timeoutMs?: number;
}
interface Release { id: number; tag: string; version: string; publishedAt: string; notes: string; assets: Record<string, unknown>[] }
interface Resolved { pin: PinnedUpdate; releaseId: number; metadataId: number }
const error = (code: string, message: string) => new ArchiveError(code, message);
const invalid = () => error('update-metadata-invalid', 'GitHub update metadata is invalid.');
const packageInvalid = () => error('update-package-invalid', 'The release is not a supported prebuilt plugin package.');
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, names: string[]) => Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
function stable(value: unknown): number[] | undefined {
  if (typeof value !== 'string' || value.length > 64 || !STABLE.test(value)) return;
  const parts = value.split('.').map(Number); return parts.every(Number.isSafeInteger) ? parts : undefined;
}
function compare(left: string, right: string): number {
  const a = stable(left)!; const b = stable(right)!;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]! ? 1 : -1;
  return 0;
}
function json(bytes: Uint8Array): unknown {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; } catch { throw invalid(); }
}
function release(value: unknown): Release | undefined {
  if (!object(value) || value.draft !== false || value.prerelease !== false || typeof value.tag_name !== 'string') return;
  const version = value.tag_name.replace(/^v/, '');
  if (!stable(version)) return;
  if (value.tag_name !== `v${version}`) throw invalid();
  if (!integer(value.id) || typeof value.published_at !== 'string' || value.published_at.length > 40
    || !Number.isFinite(Date.parse(value.published_at)) || value.html_url !== `${WEB}/tag/${value.tag_name}`
    || !Array.isArray(value.assets) || value.assets.length > 100 || !value.assets.every(object)) throw invalid();
  return { id: value.id, tag: value.tag_name, version, publishedAt: value.published_at,
    notes: typeof value.body === 'string' ? value.body.slice(0, 6000) : '', assets: value.assets };
}
function metadata(value: unknown, version: string, assetName: string): ReleaseUpdateMetadata {
  if (!object(value) || !keys(value, ['schema', 'packageName', 'version', 'requiredDshVersion', 'platforms', 'asset'])
    || value.schema !== 1 || value.packageName !== PACKAGE_NAME || value.version !== version
    || typeof value.requiredDshVersion !== 'string' || value.requiredDshVersion.length > 100 || !SEMVER.test(value.requiredDshVersion)
    || !Array.isArray(value.platforms) || value.platforms.length < 1 || value.platforms.length > 2
    || new Set(value.platforms).size !== value.platforms.length || value.platforms.some(platform => platform !== 'darwin' && platform !== 'win32')
    || !object(value.asset) || !keys(value.asset, ['name', 'bytes', 'sha256']) || value.asset.name !== assetName
    || !integer(value.asset.bytes) || value.asset.bytes > MAX.assetBytes
    || typeof value.asset.sha256 !== 'string' || !/^[a-f\d]{64}$/.test(value.asset.sha256)) throw invalid();
  return value as unknown as ReleaseUpdateMetadata;
}
function samePin(left: PinnedUpdate, right: PinnedUpdate): boolean {
  return left.assetUrl === right.assetUrl && left.sha256 === right.sha256 && JSON.stringify(left.candidate) === JSON.stringify(right.candidate);
}

/** Fixed public repository only. This source never accepts browser URLs, tokens or paths. */
export function createGithubUpdateSource(options: GithubUpdateSourceOptions): UpdateSource {
  if (!stable(options.currentVersion)) throw new TypeError('The current plugin version must be stable SemVer.');
  const limits = { ...MAX };
  for (const name of Object.keys(MAX) as (keyof Limits)[]) if (options.limits?.[name] !== undefined) {
    const value = options.limits[name]!;
    if (!integer(value) || value > MAX[name]) throw new RangeError('Invalid update response limit.');
    limits[name] = value;
  }
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!integer(timeoutMs) || timeoutMs > 30_000) throw new RangeError('Invalid update request timeout.');
  const fetcher = options.fetch ?? globalThis.fetch;
  const known = new Map<string, Resolved>();
  let retryAt = 0;
  const withBudget = async <T>(signal: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const controller = new AbortController();
    const cancel = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
    const timer = setTimeout(() => controller.abort(error('update-timeout', 'The GitHub update operation timed out.')), timeoutMs);
    try { return await operation(controller.signal); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  };
  async function read(url: string, maximum: number, signal?: AbortSignal): Promise<Uint8Array> {
    if (Date.now() < retryAt) throw new UpdateRateLimitError(retryAt);
    const controller = new AbortController(); let timedOut = false; let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const cancelled = () => error(timedOut ? 'update-timeout' : 'update-cancelled', timedOut ? 'The GitHub update request timed out.' : 'The update request was cancelled.');
    const cancel = () => { timedOut = signal?.reason instanceof ArchiveError && signal.reason.code === 'update-timeout'; controller.abort(); };
    const abort = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(cancelled()), { once: true }));
    signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const execute = async (): Promise<Uint8Array> => {
      let current = url;
      for (let redirects = 0; redirects <= 3; redirects++) {
        if (controller.signal.aborted) throw cancelled();
        const response = await fetcher(current, { method: 'GET', redirect: 'manual', credentials: 'omit', cache: 'no-store', signal: controller.signal,
          headers: { accept: current.startsWith(API) ? 'application/vnd.github+json' : 'application/octet-stream', 'user-agent': 'dsh-archive-delete-updater', 'x-github-api-version': '2022-11-28' } });
        if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); throw cancelled(); }
        if (response.redirected || (response.url && response.url !== current)) throw error('update-redirect-rejected', 'The update server redirected outside the expected request.');
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          void response.body?.cancel().catch(() => {});
          const location = response.headers.get('location'); if (!location) throw invalid();
          const next = new URL(location, current);
          if (url.startsWith(API) || next.protocol !== 'https:' || next.username || next.password || next.port || next.hash
            || !['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(next.hostname)
            || (next.hostname === 'github.com' && next.href !== url)) throw error('update-redirect-rejected', 'The update download redirected to an untrusted location.');
          current = next.href; continue;
        }
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          if (response.status === 403 || response.status === 429) {
            const now = Date.now(); const header = response.headers.get('retry-after');
            const reset = response.headers.get('x-ratelimit-reset');
            const after = header && /^\d+$/.test(header) ? now + Number(header) * 1000 : header ? Date.parse(header) : NaN;
            const limitReset = reset && /^\d+$/.test(reset) ? Number(reset) * 1000 : NaN;
            const requested = [after, limitReset].filter(value => Number.isSafeInteger(value) && value > now);
            retryAt = Math.min(now + 7 * 86_400_000, Math.max(now + 60_000, ...requested));
            throw new UpdateRateLimitError(retryAt);
          }
          throw error(response.status === 404 ? 'update-release-unavailable' : 'update-network', 'The GitHub release could not be downloaded.');
        }
        const length = response.headers.get('content-length');
        if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum)) {
          void response.body?.cancel().catch(() => {}); throw error('update-response-too-large', 'The update response exceeds its size limit.');
        }
        const chunks: Buffer[] = []; let bytes = 0; reader = response.body?.getReader();
        if (!reader) throw invalid();
        for (;;) {
          const part = await reader.read(); if (part.done) break;
          if (controller.signal.aborted) throw cancelled();
          bytes += part.value.byteLength;
          if (bytes > maximum) throw error('update-response-too-large', 'The update response exceeds its size limit.');
          chunks.push(Buffer.from(part.value));
        }
        return Buffer.concat(chunks, bytes);
      }
      throw error('update-redirect-rejected', 'The update download redirected too many times.');
    };
    try { return await Promise.race([execute(), abort]); }
    catch (caught) { if (caught instanceof ArchiveError) throw caught; if (controller.signal.aborted) throw cancelled(); throw error('update-network', 'The GitHub update request failed.'); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); void reader?.cancel().catch(() => {}); }
  }
  async function resolveRelease(item: Release, signal?: AbortSignal): Promise<Resolved | undefined> {
    const name = `qwqbig-dsh-archive-delete-${item.version}.tgz`; const metadataName = name.replace(/\.tgz$/, '.update.json');
    const asset = item.assets.filter(value => value.name === name); const meta = item.assets.filter(value => value.name === metadataName);
    if (!asset.length || !meta.length) return;
    if (asset.length !== 1 || meta.length !== 1) throw invalid();
    const packed = asset[0]!; const metadataAsset = meta[0]!;
    const assetUrl = `${WEB}/download/${item.tag}/${name}`; const metadataUrl = `${WEB}/download/${item.tag}/${metadataName}`;
    if (!integer(packed.id) || !integer(metadataAsset.id) || packed.state !== 'uploaded' || metadataAsset.state !== 'uploaded'
      || !integer(packed.size) || packed.size > limits.assetBytes || !integer(metadataAsset.size) || metadataAsset.size > limits.metadataBytes
      || packed.browser_download_url !== assetUrl || metadataAsset.browser_download_url !== metadataUrl) throw invalid();
    const bytes = await read(metadataUrl, limits.metadataBytes, signal);
    if (bytes.byteLength !== metadataAsset.size) throw invalid();
    const info = metadata(json(bytes), item.version, name);
    if (info.asset.bytes !== packed.size || (packed.digest != null && packed.digest !== `sha256:${info.asset.sha256}`)) throw invalid();
    if (info.requiredDshVersion !== options.hostVersion || !info.platforms.includes(options.platform as 'darwin' | 'win32')) return;
    const id = createHash('sha256').update(JSON.stringify({ release: item.id, asset: packed.id, metadata: metadataAsset.id,
      version: item.version, sha256: info.asset.sha256, bytes: packed.size, host: info.requiredDshVersion, platforms: info.platforms })).digest('hex');
    const candidate: UpdateCandidate = { id, version: item.version, requiredDshVersion: info.requiredDshVersion, publishedAt: item.publishedAt,
      releaseUrl: `${WEB}/tag/${item.tag}`, notes: item.notes, assetBytes: info.asset.bytes };
    return { pin: { candidate, assetUrl, sha256: info.asset.sha256 }, releaseId: item.id, metadataId: metadataAsset.id };
  }
  const trusted = (pin: PinnedUpdate): Resolved => {
    const record = known.get(pin.candidate.id);
    if (!record || !samePin(record.pin, pin)) throw error('update-source-changed', 'The confirmed update changed. Check for updates again.');
    return record;
  };
  return {
    async check(signal): Promise<ReleaseCheck> {
      return withBudget(signal, async signal => {
        const response = json(await read(`${API}?per_page=20`, limits.releasesBytes, signal)); if (!Array.isArray(response)) throw invalid();
        const newer = response.slice(0, 20).flatMap(value => { const item = release(value); return item && compare(item.version, options.currentVersion) > 0 ? [item] : []; })
          .sort((a, b) => compare(b.version, a.version)).slice(0, 5);
        let failure: ArchiveError | undefined;
        for (const item of newer) {
          try {
            const resolved = await resolveRelease(item, signal); if (!resolved) continue;
            known.set(resolved.pin.candidate.id, structuredClone(resolved));
            while (known.size > 8) known.delete(known.keys().next().value!);
            return { availability: 'available', candidate: structuredClone(resolved.pin.candidate), pinned: structuredClone(resolved.pin) };
          } catch (caught) { if (caught instanceof ArchiveError && caught.code === 'update-metadata-invalid') failure = caught; else throw caught; }
        }
        if (failure) throw failure;
        return newer.length ? { availability: 'incompatible', code: 'update-incompatible' } : { availability: 'current' };
      });
    },
    async revalidate(pin, signal): Promise<void> {
      return withBudget(signal, async signal => {
        const record = trusted(pin); const item = release(json(await read(`${API}/${record.releaseId}`, limits.releasesBytes, signal)));
        if (!item || item.id !== record.releaseId || compare(item.version, options.currentVersion) <= 0) throw error('update-source-changed', 'The confirmed release is no longer available.');
        const current = await resolveRelease(item, signal);
        if (!current || !samePin(current.pin, record.pin)) throw error('update-source-changed', 'The confirmed update changed. Check for updates again.');
      });
    },
    async download(pin, signal): Promise<Uint8Array> {
      return withBudget(signal, async signal => {
        const record = trusted(pin);
        const bytes = await read(record.pin.assetUrl, Math.min(limits.assetBytes, record.pin.candidate.assetBytes), signal);
        if (bytes.byteLength !== record.pin.candidate.assetBytes || createHash('sha256').update(bytes).digest('hex') !== record.pin.sha256)
          throw error('update-checksum', 'The downloaded update does not match its confirmed SHA-256 checksum.');
        await validatePackage(bytes, record.pin.candidate.version, options.hostVersion, limits); if (signal?.aborted) throw error('update-cancelled', 'The update request was cancelled.');
        return bytes;
      });
    },
  };
}

function octal(header: Buffer, start: number, length: number): number {
  const text = header.subarray(start, start + length).toString('ascii').replace(/\0.*$/, '').trim();
  if (!/^[0-7]+$/.test(text)) throw packageInvalid();
  const value = Number.parseInt(text, 8); if (!Number.isSafeInteger(value)) throw packageInvalid(); return value;
}
function text(header: Buffer, start: number, length: number): string {
  const field = header.subarray(start, start + length); const end = field.indexOf(0);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(end < 0 ? field : field.subarray(0, end)); } catch { throw packageInvalid(); }
}
async function validatePackage(bytes: Uint8Array, version: string, hostVersion: string, limits: Limits): Promise<void> {
  if (!stable(version) || !SEMVER.test(hostVersion) || !bytes.byteLength || bytes.byteLength > limits.assetBytes) throw packageInvalid();
  let tar: Buffer;
  try { tar = await new Promise<Buffer>((resolve, reject) => gunzip(bytes, { maxOutputLength: limits.expandedBytes }, (caught, value) => caught ? reject(caught) : resolve(value))); }
  catch { throw packageInvalid(); }
  if (tar.length % 512 !== 0) throw packageInvalid();
  const seen = new Set<string>(); const filePaths = new Set<string>(); const files = new Map<string, Buffer>(); let terminated = false; let count = 0;
  for (let offset = 0; offset < tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(value => value === 0)) {
      if (offset + 1024 > tar.length || !tar.subarray(offset).every(value => value === 0)) throw packageInvalid();
      terminated = true; break;
    }
    if (++count > limits.tarEntries || header.length !== 512 || !['ustar\0', 'ustar '].includes(header.subarray(257, 263).toString('ascii'))) throw packageInvalid();
    let checksum = 0; for (let index = 0; index < 512; index++) checksum += index >= 148 && index < 156 ? 32 : header[index]!;
    if (octal(header, 148, 8) !== checksum) throw packageInvalid();
    const type = header[156]; if (type !== 0 && type !== 48 && type !== 53) throw packageInvalid();
    const prefix = text(header, 345, 155); let name = `${prefix ? `${prefix}/` : ''}${text(header, 0, 100)}`;
    if (type === 53) name = name.replace(/\/$/, '');
    if (name.length > 512 || !name || name.split('/').some(part => !part || part === '.' || part === '..'
      || /[\\<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))
      || (name !== 'package' && !name.startsWith('package/')) || name.split('/').includes('node_modules') || seen.has(name.toLowerCase())) throw packageInvalid();
    const lower = name.toLowerCase();
    if ([...filePaths].some(path => lower.startsWith(`${path}/`)) || (type !== 53 && [...seen].some(path => path.startsWith(`${lower}/`)))) throw packageInvalid();
    seen.add(lower); const size = octal(header, 124, 12); const mode = octal(header, 100, 8);
    if ((mode & 0o7000) !== 0 || (type === 53 && size !== 0) || offset + 512 + size > tar.length) throw packageInvalid();
    if (type !== 53) { filePaths.add(lower); files.set(name, tar.subarray(offset + 512, offset + 512 + size)); }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (!terminated) throw packageInvalid();
  const manifest = files.get('package/package.json'); if (!manifest || manifest.length > 64 * 1024) throw packageInvalid();
  let pkg: unknown; try { pkg = json(manifest); } catch { throw packageInvalid(); }
  if (!object(pkg) || pkg.name !== PACKAGE_NAME || pkg.version !== version || !object(pkg.engines) || pkg.engines.dsh !== hostVersion
    || pkg.main !== './lib/index.js' || !object(pkg.dsh) || pkg.dsh.manifestVersion !== 1 || !object(pkg.dsh.bundle) || pkg.dsh.bundle.patch !== './cordis.patch.yml') throw packageInvalid();
  for (const path of ['package/cordis.patch.yml', 'package/lib/index.js', 'package/lib/client.js']) if (!files.get(path)?.length) throw packageInvalid();
  for (const key of ['dependencies', 'optionalDependencies']) {
    const value = pkg[key]; if (value !== undefined && (!object(value) || Object.keys(value).length !== 0)) throw packageInvalid();
  }
  for (const key of ['bundleDependencies', 'bundledDependencies']) if (pkg[key] !== undefined
    && !(Array.isArray(pkg[key]) && pkg[key].length === 0)) throw packageInvalid();
  if (pkg.scripts !== undefined && (!object(pkg.scripts) || ['preinstall', 'install', 'postinstall', 'prepare'].some(name => Object.hasOwn(pkg.scripts as object, name)))) throw packageInvalid();
  if (pkg.peerDependencies !== undefined) {
    if (!object(pkg.peerDependencies) || !object(pkg.peerDependenciesMeta)) throw packageInvalid();
    for (const [name, value] of Object.entries(pkg.peerDependencies)) {
      const meta = pkg.peerDependenciesMeta[name];
      if (!PEERS.has(name) || typeof value !== 'string' || value.length > 100 || !/^[\dA-Za-z.*^~<>=| -]+$/.test(value)
        || !object(meta) || meta.optional !== true) throw packageInvalid();
    }
  }
}

/** Reusable immediately before native installation; no extraction or execution. */
export async function validateUpdatePackage(bytes: Uint8Array, version: string, requiredDshVersion: string): Promise<void> {
  await validatePackage(bytes, version, requiredDshVersion, MAX);
}
