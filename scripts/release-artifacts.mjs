import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { lstat, open, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tsImport } from 'tsx/esm/api';

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
// Refuse unsupported package contents before publishing either checksum file.
// This is the exact bounded admission path used by an installed updater.
const { validateUpdatePackage, supportedPackageDshVersions, inspectUpdatePackageCompatibility } = await tsImport('../src/update-source.ts', import.meta.url);
const hosts = supportedPackageDshVersions(pkg);
const packed = await inspectUpdatePackageCompatibility(bytes, pkg.version, pkg.engines.dsh);
assert.equal(packed.primaryDshVersion, pkg.engines.dsh, 'The packed legacy engine must match the release primary.');
assert.deepEqual(packed.supportedDshVersions.toSorted(), hosts.toSorted(), 'The packed host declarations must match the release manifest.');
for (const host of hosts) await validateUpdatePackage(bytes, pkg.version, host);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const metadataFilename = filename.replace(/\.tgz$/, '.update.json');
const metadataFiles = hosts.map(host => ({ name: host === pkg.engines.dsh ? metadataFilename : filename.replace(/\.tgz$/, `.dsh-${host}.update.json`),
  metadata: { schema: 1, packageName: pkg.name, version: pkg.version, requiredDshVersion: host,
    platforms: ['darwin', 'win32'], asset: { name: filename, bytes: bytes.length, sha256 } } }));
await writeFile(`${path}.sha256`, `${sha256}  ${filename}\n`);
for (const item of metadataFiles) await writeFile(join(resolve(process.argv[2] ?? 'artifacts'), item.name), `${JSON.stringify(item.metadata, null, 2)}\n`);
console.log(JSON.stringify({ file: filename, bytes: bytes.length, sha256, metadata: metadataFilename,
  hostMetadata: metadataFiles.filter(item => item.name !== metadataFilename).map(item => item.name) }));
