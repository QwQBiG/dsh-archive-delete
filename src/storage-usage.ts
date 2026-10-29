import { lstat, opendir, realpath } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { assertCanonicalStoragePath, assertLocalStoragePath, isWithin, samePath } from './filesystem.js';

export interface UsageRoot {
  id: string; kind: string; label?: string; path?: string; unavailableReason?: string; readOnly: true;
  /** Trusted server paths for separately inventoried descendants; never client input. */
  excludePaths?: string[];
  /** Measure exactly this regular file, never its parent. Omitted means directory-only. */
  file?: true;
}
export interface UsageFile { relativePath: string; sizeBytes: number; source: 'unknown' }
/** Directory totals count paths, including hard-link aliases; these are logical file bytes. */
export interface UsageDirectory { relativePath: string; fileBytes: number; fileCount: number }
export interface UsageCounters {
  entries: number; files: number; directories: number; symlinks: number; unreadable: number;
  changed: number; unsupported: number; crossDevice: number; depthLimit: number; excluded: number;
  duplicateHardlinks: number; duplicatePaths: number; identityUnknown: number;
}
export interface UsageIssue { code: string; relativePath?: string }
export interface UsageCategory {
  id: string; kind: string; label?: string; readOnly: true;
  status: 'complete' | 'partial' | 'missing' | 'unavailable';
  fileBytes: number | null; referencedBytes: number | null; fileCount: number; uniqueFileCount: number;
  counters: UsageCounters; issues: UsageIssue[]; overlaps: string[];
  largestFiles: UsageFile[]; directories: UsageDirectory[];
}
export interface StorageUsage {
  metric: 'logical-file-bytes'; startedAt: number; finishedAt: number; durationMs: number; complete: boolean;
  fileBytes: number; referencedBytes: number; fileCount: number; uniqueFileCount: number;
  duplicateHardlinks: number; duplicatePaths: number; identityUnknown: number; categories: UsageCategory[];
}
export type UsageScanResult = StorageUsage;
export interface UsageScanOptions {
  maxEntries?: number; maxDepth?: number; maxDurationMs?: number; largestLimit?: number; directoryLimit?: number;
  signal?: AbortSignal;
  /** Bounded progress reporting also allows deterministic cancellation/race tests. */
  yieldEvery?: number; onProgress?(progress: { entries: number; files: number }): void;
  /** Monotonic millisecond clock; defaults to performance.now(). */
  clock?: () => number;
}
const counters = (): UsageCounters => ({ entries: 0, files: 0, directories: 0, symlinks: 0, unreadable: 0,
  changed: 0, unsupported: 0, crossDevice: 0, depthLimit: 0, excluded: 0, duplicateHardlinks: 0, duplicatePaths: 0, identityUnknown: 0 });
const code = (error: unknown): string => typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'unreadable';
const signature = (s: BigIntStats): string => `${s.dev}:${s.ino}:${s.mode}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
const pathKey = (path: string): string => process.platform === 'win32' ? path.toLowerCase() : path;
function limit(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError('Invalid storage scan limit.');
  return value;
}

/** Metadata-only observation. Results are never deletion authority or a promise of reclaimed disk space. */
export async function scanStorage(roots: UsageRoot[], options: UsageScanOptions = {}): Promise<StorageUsage> {
  if (roots.length > 128 || new Set(roots.map(root => root.id)).size !== roots.length
    || roots.some(root => !root.id || root.readOnly !== true)) throw new TypeError('Storage roots must have unique IDs and be read-only.');
  const maxEntries = limit(options.maxEntries, 50_000, 1, 500_000);
  const maxDepth = limit(options.maxDepth, 32, 0, 64);
  const maxDurationMs = limit(options.maxDurationMs, 3_000, 0, 30_000);
  const largestLimit = limit(options.largestLimit, 20, 0, 100);
  const directoryLimit = limit(options.directoryLimit, 20, 0, 100);
  const yieldEvery = limit(options.yieldEvery, 64, 1, 1024);
  const clock = options.clock ?? (() => performance.now());
  const startedAt = Date.now(); const tick = clock();
  const categories: UsageCategory[] = roots.map(root => ({ id: root.id, kind: root.kind, ...(root.label ? { label: root.label } : {}),
    readOnly: true, status: 'complete', fileBytes: null, referencedBytes: null, fileCount: 0, uniqueFileCount: 0,
    counters: counters(), issues: [], overlaps: [], largestFiles: [], directories: [] }));
  const globalIdentities = new Set<string>(); const globalPaths = new Set<string>();
  const measuredRoots: { id: string; path: string; excludes: string[] }[] = [];
  const excluded = (paths: string[], path: string) => paths.some(skip => samePath(skip, path) || isWithin(skip, path));
  let entries = 0; let fileCount = 0; let uniqueFileCount = 0; let fileBytes = 0; let referencedBytes = 0;
  let duplicateHardlinks = 0; let duplicatePaths = 0; let identityUnknown = 0;
  let yieldedAt = 0;
  const halted = () => options.signal?.aborted ? 'cancelled' : clock() - tick >= maxDurationMs ? 'time-budget' : entries >= maxEntries ? 'entry-budget' : undefined;
  const issue = (category: UsageCategory, problem: string, path?: string) => {
    category.status = 'partial';
    if (category.issues.length < 32 && !category.issues.some(item => item.code === problem && item.relativePath === path))
      category.issues.push({ code: problem, ...(path ? { relativePath: path } : {}) });
  };
  const checkpoint = async (category: UsageCategory) => {
    if (entries - yieldedAt >= yieldEvery) {
      yieldedAt = entries;
      try { options.onProgress?.({ entries, files: fileCount }); } catch { /* Reporting cannot authorize or abort filesystem work. */ }
      await setImmediate();
    }
    const reason = halted(); if (reason) issue(category, reason); return !reason;
  };

  for (const [index, root] of roots.entries()) {
    const category = categories[index]!;
    if (!root.path) {
      category.status = 'unavailable'; category.issues.push({ code: root.unavailableReason ?? 'root-unresolved' }); continue;
    }
    if (!await checkpoint(category)) continue;
    const localIdentities = new Set<string>(); const localPaths = new Set<string>();
    const folders = new Map<string, UsageDirectory>();
    const observations: { path: string; relativePath: string; signature: string }[] = [];
    const rootIsFile = root.file === true;
    let rootPath: string; let canonicalRoot: string; let rootDevice: bigint; let rootSignature: string; let excludes: string[];
    try {
      assertLocalStoragePath(root.path); rootPath = resolve(root.path);
      const before = await lstat(rootPath, { bigint: true });
      if (before.isSymbolicLink() || (rootIsFile ? !before.isFile() : !before.isDirectory())) throw Object.assign(new Error('Unsafe root.'), { code: 'unsafe-root' });
      canonicalRoot = await realpath(rootPath); await assertCanonicalStoragePath(rootPath, canonicalRoot);
      const after = await lstat(rootPath, { bigint: true });
      if ((rootIsFile ? !after.isFile() : !after.isDirectory()) || after.isSymbolicLink() || signature(before) !== signature(after)) throw Object.assign(new Error('Changed root.'), { code: 'root-changed' });
      rootDevice = after.dev; rootSignature = signature(after);
      if ((root.excludePaths?.length ?? 0) > 128) throw Object.assign(new Error('Too many exclusions.'), { code: 'unsafe-exclusion' });
      excludes = (root.excludePaths ?? []).map(path => {
        assertLocalStoragePath(path); const normalized = resolve(path);
        if (rootIsFile || (!isWithin(rootPath, normalized) && !isWithin(canonicalRoot, normalized)))
          throw Object.assign(new Error('Exclusions must be proper descendants.'), { code: 'unsafe-exclusion' });
        return isWithin(rootPath, normalized) ? join(canonicalRoot, relative(rootPath, normalized)) : normalized;
      });
      category.fileBytes = 0; category.referencedBytes = 0;
      for (const known of measuredRoots) if (samePath(known.path, canonicalRoot)
        || (isWithin(known.path, canonicalRoot) && !excluded(known.excludes, canonicalRoot))
        || (isWithin(canonicalRoot, known.path) && !excluded(excludes, known.path))) {
        category.overlaps.push(known.id); categories.find(item => item.id === known.id)!.overlaps.push(root.id);
      }
      measuredRoots.push({ id: root.id, path: canonicalRoot, excludes });
    } catch (error) {
      category.status = code(error) === 'ENOENT' ? 'missing' : 'unavailable';
      category.issues.push({ code: code(error) }); continue;
    }

    const canonicalFor = (rel: string) => rootIsFile ? canonicalRoot : join(canonicalRoot, rel === '.' ? '' : rel);
    const inspect = async (path: string, rel: string): Promise<BigIntStats | undefined> => {
      if (!await checkpoint(category)) return undefined;
      entries++; category.counters.entries++;
      try {
        const before = await lstat(path, { bigint: true });
        if (samePath(path, rootPath) && signature(before) !== rootSignature) {
          category.counters.changed++; issue(category, 'root-changed', rel); return undefined;
        }
        if (before.isSymbolicLink()) { category.counters.symlinks++; issue(category, 'link-skipped', rel); return undefined; }
        if (!before.isFile() && !before.isDirectory()) { category.counters.unsupported++; issue(category, 'special-file-skipped', rel); return undefined; }
        if (before.dev !== rootDevice) { category.counters.crossDevice++; issue(category, 'cross-device-skipped', rel); return undefined; }
        const canonical = await realpath(path);
        if (!samePath(canonical, canonicalFor(rel))) {
          category.counters.changed++; issue(category, 'path-redirected', rel); return undefined;
        }
        await assertCanonicalStoragePath(path, canonical);
        const after = await lstat(path, { bigint: true });
        if (after.isSymbolicLink() || signature(before) !== signature(after)) {
          category.counters.changed++; issue(category, 'entry-changed', rel); return undefined;
        }
        observations.push({ path, relativePath: rel, signature: signature(after) });
        return after;
      } catch (error) {
        if (code(error) === 'ENOENT') category.counters.changed++; else category.counters.unreadable++;
        issue(category, code(error) === 'ENOENT' ? 'entry-disappeared' : 'entry-unreadable', rel); return undefined;
      }
    };
    const add = (before: number, bytes: number): number => {
      if (bytes > Number.MAX_SAFE_INTEGER - before) { issue(category, 'aggregate-size-limit'); return Number.MAX_SAFE_INTEGER; }
      return before + bytes;
    };
    const addFile = (rel: string, stat: BigIntStats) => {
      if (stat.size < 0n || stat.size > BigInt(Number.MAX_SAFE_INTEGER)) { category.counters.unsupported++; issue(category, 'size-unrepresentable', rel); return; }
      const bytes = Number(stat.size); const key = pathKey(canonicalFor(rel));
      const identity = stat.ino > 0n && stat.dev > 0n ? `${stat.dev}:${stat.ino}` : undefined;
      category.fileCount++; category.counters.files++; fileCount++;
      category.referencedBytes = add(category.referencedBytes!, bytes); referencedBytes = add(referencedBytes, bytes);
      const folder = rel.includes(sep) ? rel.split(sep)[0]! : '.';
      const summary = folders.get(folder) ?? { relativePath: folder, fileBytes: 0, fileCount: 0 };
      summary.fileBytes = add(summary.fileBytes, bytes); summary.fileCount++; folders.set(folder, summary);
      if (localPaths.has(key)) category.counters.duplicatePaths++;
      else if (identity && localIdentities.has(identity)) category.counters.duplicateHardlinks++;
      else { category.fileBytes = add(category.fileBytes!, bytes); category.uniqueFileCount++; }
      if (globalPaths.has(key)) duplicatePaths++;
      else if (identity && globalIdentities.has(identity)) duplicateHardlinks++;
      else { fileBytes = add(fileBytes, bytes); uniqueFileCount++; }
      if (!identity) { category.counters.identityUnknown++; identityUnknown++; }
      localPaths.add(key); globalPaths.add(key); if (identity) { localIdentities.add(identity); globalIdentities.add(identity); }
      category.largestFiles.push({ relativePath: rel.split(sep).join('/'), sizeBytes: bytes, source: 'unknown' });
      category.largestFiles.sort((a, b) => b.sizeBytes - a.sizeBytes || a.relativePath.localeCompare(b.relativePath));
      category.largestFiles.length = Math.min(category.largestFiles.length, largestLimit);
    };
    const walk = async (path: string, rel: string, depth: number): Promise<void> => {
      if (excluded(excludes, canonicalFor(rel))) {
        if (await checkpoint(category)) { entries++; category.counters.entries++; category.counters.excluded++; }
        return;
      }
      const stat = await inspect(path, rel); if (!stat) return;
      if (stat.isFile()) { addFile(rel, stat); return; }
      category.counters.directories++;
      if (depth > maxDepth) { category.counters.depthLimit++; issue(category, 'depth-limit', rel); return; }
      let directory;
      try {
        directory = await opendir(path, { bufferSize: 32 });
        const current = await lstat(path, { bigint: true }); const canonical = await realpath(path);
        if (current.isSymbolicLink() || signature(current) !== signature(stat) || !samePath(canonical, canonicalFor(rel))) {
          category.counters.changed++; issue(category, 'directory-changed', rel); return;
        }
        for (;;) {
          if (!await checkpoint(category)) break;
          const child = await directory.read(); if (!child) break;
          await walk(join(path, child.name), rel === '.' ? child.name : join(rel, child.name), depth + 1);
        }
      } catch (error) { category.counters.unreadable++; issue(category, 'directory-unreadable', rel); }
      finally { if (directory) await directory.close().catch(() => {}); }
    };
    await walk(rootPath, rootIsFile ? basename(canonicalRoot) : '.', 0);
    // A scan is an observation window, not a snapshot. Recheck counted identities
    // so concurrent writes/removals are disclosed instead of called complete.
    for (const observation of observations) {
      if (!await checkpoint(category)) break;
      try {
        const current = await lstat(observation.path, { bigint: true }); const canonical = await realpath(observation.path);
        if (current.isSymbolicLink() || signature(current) !== observation.signature
          || !samePath(canonical, canonicalFor(observation.relativePath))) {
          category.counters.changed++; issue(category, 'entry-changed', observation.relativePath);
        }
      } catch { category.counters.changed++; issue(category, 'entry-disappeared', observation.relativePath); }
    }
    category.directories = [...folders.values()].sort((a, b) => b.fileBytes - a.fileBytes || a.relativePath.localeCompare(b.relativePath)).slice(0, directoryLimit);
  }
  const finishedAt = Date.now();
  return { metric: 'logical-file-bytes', startedAt, finishedAt, durationMs: Math.max(0, clock() - tick),
    complete: categories.every(category => category.status === 'complete'), fileBytes, referencedBytes, fileCount, uniqueFileCount,
    duplicateHardlinks, duplicatePaths, identityUnknown, categories };
}
