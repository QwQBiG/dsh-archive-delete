import { constants, type BigIntStats } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { ArchiveError } from './contracts.js';
import { readBoundedJson } from './filesystem.js';

const MAX_ARCHIVE_BYTES = 1024n * 1024n * 1024n;
const signature = (stat: BigIntStats) => `${stat.dev}:${stat.ino}:${stat.mode}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
// Electron assigns a fresh synthetic inode on every virtual lstat call. The
// physical archive supplies identity; entry metadata supplies shape and size.
const entrySignature = (stat: BigIntStats) => `${stat.mode}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
function invalid(): ArchiveError { return new ArchiveError('corrupt-state', 'The installed host manifest is invalid or too large.'); }
function changed(): ArchiveError { return new ArchiveError('unsafe-path', 'The installed host archive or manifest changed while reading.'); }
function archivePath(path: string): string | undefined {
  if (!process.versions.electron) return undefined;
  const match = /\.asar(?=[/\\])/i.exec(path);
  return match ? path.slice(0, match.index + '.asar'.length) : undefined;
}
function plainArchive(stat: BigIntStats): boolean {
  return stat.isFile() && !stat.isSymbolicLink() && stat.size > 0n && stat.size <= MAX_ARCHIVE_BYTES;
}
function plainEntry(stat: BigIntStats, limit: number): boolean {
  return stat.isFile() && !stat.isSymbolicLink() && stat.size >= 0n && stat.size <= BigInt(limit);
}

/** Read installed host code manifests. Electron's ASAR entry and extracted file
 * descriptors have different inodes, so virtual entries are bounded and checked
 * against their containing archive instead. Recovery/profile JSON must continue
 * using readBoundedJson and its regular-file identity checks. */
export async function readHostManifest(path: string, limit = 1024 * 1024): Promise<unknown> {
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 8 * 1024 * 1024) throw new RangeError('Invalid host manifest size limit.');
  const normalized = resolve(path);
  const archive = archivePath(normalized);
  if (!archive) return readBoundedJson(path, limit);
  // Electron virtualizes the archive path itself too. Its built-in original-fs
  // reads only the containing physical file; entry access stays on virtual fs.
  const physical = (createRequire(import.meta.url)('original-fs') as typeof import('node:fs')).promises;
  const before = await physical.lstat(archive, { bigint: true });
  if (!plainArchive(before)) throw invalid();
  const handle = await physical.open(archive, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const held = await handle.stat({ bigint: true });
    const current = await physical.lstat(archive, { bigint: true });
    if (!plainArchive(held) || !plainArchive(current) || signature(before) !== signature(held) || signature(before) !== signature(current)) throw changed();
    const entry = await lstat(normalized, { bigint: true });
    if (!plainEntry(entry, limit)) throw invalid();
    const bytes = await readFile(normalized);
    const afterEntry = await lstat(normalized, { bigint: true });
    const afterArchive = await physical.lstat(archive, { bigint: true });
    const afterHeld = await handle.stat({ bigint: true });
    if (!plainEntry(afterEntry, limit) || bytes.byteLength > limit || BigInt(bytes.byteLength) !== entry.size
      || entrySignature(entry) !== entrySignature(afterEntry) || !plainArchive(afterArchive) || !plainArchive(afterHeld)
      || signature(before) !== signature(afterArchive) || signature(before) !== signature(afterHeld)) throw changed();
    try { return JSON.parse(bytes.toString('utf8')) as unknown; }
    catch { throw invalid(); }
  } finally { await handle.close(); }
}
