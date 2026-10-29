import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const exactVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
function validVersion(value, stable = false) {
  if (typeof value !== 'string' || value.length > 128) return false;
  const match = (stable ? stableVersion : exactVersion).exec(value);
  return match !== null && match.slice(1, 4).every(part => Number.isSafeInteger(Number(part)))
    && (!match[4] || match[4].split('.').every(part => !/^\d+$/.test(part) || part === '0' || !part.startsWith('0')));
}

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
if (pkg.name !== '@qwqbig/dsh-archive-delete' || !validVersion(pkg.version, true) || !validVersion(pkg.engines?.dsh))
  throw new Error('Update artifacts require the fixed package name, a stable version, and an exact DSH version.');
const filename = `${pkg.name.replace(/^@/, '').replaceAll('/', '-')}-${pkg.version}.tgz`;
const path = join(resolve(process.argv[2] ?? 'artifacts'), filename);
const before = await lstat(path, { bigint: true });
if (!before.isFile() || before.isSymbolicLink() || before.size <= 0n || before.size > 16n * 1024n * 1024n)
  throw new Error('The packed release must be a regular gzip file no larger than 16 MiB.');
const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
const chunks = []; let length = 0;
try {
  const held = await handle.stat({ bigint: true });
  if (!held.isFile() || held.dev !== before.dev || held.ino !== before.ino)
    throw new Error('The packed release identity changed before reading.');
  for await (const chunk of handle.createReadStream({ autoClose: false, highWaterMark: 64 * 1024 })) {
    length += chunk.length;
    if (length > 16 * 1024 * 1024) throw new Error('The packed release exceeds 16 MiB.');
    chunks.push(chunk);
  }
} finally { await handle.close(); }
const bytes = Buffer.concat(chunks, length);
const after = await lstat(path, { bigint: true });
if (BigInt(bytes.length) !== before.size || before.dev !== after.dev || before.ino !== after.ino
  || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs)
  throw new Error('The packed release changed while generating its metadata.');
// Verify gzip integrity while bounding the expanded bytes; archive/package
// validation is performed by the updater before installation.
gunzipSync(bytes, { maxOutputLength: 64 * 1024 * 1024 });
const sha256 = createHash('sha256').update(bytes).digest('hex');
const metadataFilename = filename.replace(/\.tgz$/, '.update.json');
const metadata = { schema: 1, packageName: pkg.name, version: pkg.version, requiredDshVersion: pkg.engines.dsh,
  platforms: ['darwin', 'win32'], asset: { name: filename, bytes: bytes.length, sha256 } };
await writeFile(`${path}.sha256`, `${sha256}  ${filename}\n`);
await writeFile(join(resolve(process.argv[2] ?? 'artifacts'), metadataFilename), `${JSON.stringify(metadata, null, 2)}\n`);
console.log(JSON.stringify({ file: filename, bytes: bytes.length, sha256, metadata: metadataFilename }));
