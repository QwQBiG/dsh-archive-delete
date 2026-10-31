import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep, win32 } from 'node:path';
import { ArchiveError } from './contracts.js';

export function samePath(left: string, right: string): boolean {
  return relative(resolve(left), resolve(right)) === '';
}
export function isWithin(root: string, path: string): boolean {
  const part = relative(resolve(root), resolve(path));
  return part !== '' && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part);
}

/** Windows storage uses local drive paths, without namespace/device aliases. */
export function assertLocalStoragePath(path: string, platform = process.platform): void {
  if (platform !== 'win32') {
    if (!isAbsolute(path)) throw new ArchiveError('unsafe-path', 'Storage paths must be absolute.');
    return;
  }
  const root = win32.parse(path).root;
  if (!/^[A-Za-z]:[\\/]$/.test(root) || !win32.isAbsolute(path))
    throw new ArchiveError('unsafe-path', 'Windows storage requires a local absolute drive path.');
  const parts = path.slice(root.length).split(/[\\/]/);
  if (parts.some(part => part === '.' || part === '..' || /[<>:"|?*\x00-\x1f]/.test(part)
    || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part)))
    throw new ArchiveError('unsafe-path', 'Windows storage contains a device name or ambiguous path.');
}

export async function assertPlainDirectory(path: string): Promise<void> {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ArchiveError('unsafe-path', 'A data directory is not a plain directory.');
}
/** Named Windows locks must not acquire distinct identities for the same data. */
export async function assertCanonicalStoragePath(path: string, canonical?: string, platform = process.platform): Promise<void> {
  if (platform !== 'win32') return;
  const physical = canonical ?? await realpath(path);
  assertLocalStoragePath(path, platform); assertLocalStoragePath(physical, platform);
  if (win32.relative(win32.resolve(path), win32.resolve(physical)) !== '')
    throw new ArchiveError('unsafe-path', 'Windows storage paths must use their canonical local path, without junction or short-name aliases.');
}
export async function assertPrivateDirectory(path: string): Promise<void> {
  await assertPlainDirectory(path);
  const stat = await lstat(path);
  // Windows modes do not describe ACLs. New files inherit the existing DSH home's ACL.
  if (process.platform !== 'win32' && ((typeof process.getuid === 'function' && stat.uid !== process.getuid()) || (stat.mode & 0o022) !== 0))
    throw new ArchiveError('unsafe-path', 'Plugin storage must be owned by this user and not writable by others.');
}

export async function syncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') {
    // Node cannot open a Windows directory for fsync. File contents are flushed
    // before atomic publication; journals reconcile process interruptions.
    await assertPlainDirectory(path);
    return;
  }
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

/** Verify both path and opened identity; Windows has no O_NOFOLLOW flag. */
export async function readBoundedJson(path: string, limit = 8 * 1024 * 1024): Promise<unknown> {
  const before = await lstat(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(limit))
    throw new ArchiveError('corrupt-state', 'Recovery metadata is invalid.');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const held = await handle.stat({ bigint: true });
    const current = await lstat(path, { bigint: true });
    if (!held.isFile() || current.isSymbolicLink() || !current.isFile() || held.size > BigInt(limit)
      || before.dev !== held.dev || before.ino !== held.ino || current.dev !== held.dev || current.ino !== held.ino)
      throw new ArchiveError('unsafe-path', 'Recovery metadata identity changed.');
    const encoded = await handle.readFile('utf8');
    if (Buffer.byteLength(encoded) > limit) throw new ArchiveError('corrupt-state', 'Recovery metadata is too large.');
    try { return JSON.parse(encoded) as unknown; }
    catch { throw new ArchiveError('corrupt-state', 'Recovery metadata could not be read.'); }
  } finally { await handle.close(); }
}
