import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test, { type TestContext } from 'node:test';
import { readHostManifest } from '../src/host-manifest.js';
import { readBoundedJson } from '../src/filesystem.js';
import { runDoctor } from '../src/doctor.js';

const physical = process.versions.electron ? (createRequire(import.meta.url)('original-fs') as typeof import('node:fs')).promises : await import('node:fs/promises');

async function fixture(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'archive-host-manifest-')));
  t.after(() => physical.rm(root, { recursive: true, force: true }));
  return root;
}
const electron = Boolean(process.versions.electron);

/** A single-file test archive encoded using Chromium's Pickle framing. This is
 * fixture generation only; production reads use Electron's native virtual fs. */
async function archive(root: string, contents: string, aliases = false): Promise<{ path: string; entry: string }> {
  const bytes = Buffer.from(contents);
  const json = Buffer.from(JSON.stringify({ files: { 'manifest.json': { size: bytes.length, offset: '0' }, 'package.json': { size: bytes.length, offset: '0' },
    ...(aliases ? { 'linked.json': { link: 'manifest.json' } } : {}) } }));
  const padding = Math.ceil(json.length / 4) * 4;
  const header = Buffer.alloc(8 + padding);
  header.writeUInt32LE(4 + padding, 0); header.writeUInt32LE(json.length, 4); json.copy(header, 8);
  const size = Buffer.alloc(8); size.writeUInt32LE(4, 0); size.writeUInt32LE(header.length, 4);
  const path = join(root, 'host.asar'); await writeFile(path, Buffer.concat([size, header, bytes]));
  return { path, entry: join(path, 'manifest.json') };
}

test('ordinary installed manifests retain strict bounded regular-file parsing and source bytes', async t => {
  const root = await fixture(t); const path = join(root, 'package.json'); const source = '{"name":"@deepseek-ai/dsh","version":"0.2.1-rc.5"}';
  await writeFile(path, source);
  assert.deepEqual(await readHostManifest(path), { name: '@deepseek-ai/dsh', version: '0.2.1-rc.5' });
  assert.equal(await readFile(path, 'utf8'), source);
  await assert.rejects(readHostManifest(path, 4), { code: 'corrupt-state' });
  await writeFile(path, '{invalid'); await assert.rejects(readHostManifest(path), { code: 'corrupt-state' });
  for (const limit of [0, -1, 0.5, Infinity, 8 * 1024 * 1024 + 1]) await assert.rejects(readHostManifest(path, limit), RangeError);
});

test('ordinary manifest links keep the recovery reader rejection', { skip: process.platform === 'win32' }, async t => {
  const root = await fixture(t); const original = join(root, 'original.json'); const linked = join(root, 'linked.json');
  await writeFile(original, '{"keep":true}'); await symlink(original, linked);
  await assert.rejects(readHostManifest(linked), { code: 'corrupt-state' });
  assert.equal(await readFile(original, 'utf8'), '{"keep":true}');
});

test('Electron reads a bounded ASAR host manifest while the recovery reader stays strict', { skip: !electron }, async t => {
  const root = await fixture(t); const source = '{"name":"@deepseek-ai/dsh","version":"0.2.1-rc.5"}';
  const packed = await archive(root, source);
  const before = createHash('sha256').update(await physical.readFile(packed.path)).digest('hex');
  await assert.rejects(readBoundedJson(packed.entry), { code: 'unsafe-path' });
  assert.deepEqual(await readHostManifest(packed.entry), JSON.parse(source));
  assert.equal(await readFile(packed.entry, 'utf8'), source);
  assert.equal(createHash('sha256').update(await physical.readFile(packed.path)).digest('hex'), before);
});

test('Electron rejects malformed and oversized virtual manifest entries', { skip: !electron }, async t => {
  const malformed = await archive(await fixture(t), '{invalid');
  await assert.rejects(readHostManifest(malformed.entry), { code: 'corrupt-state' });
  const large = await archive(await fixture(t), JSON.stringify({ body: 'x'.repeat(128) }));
  await assert.rejects(readHostManifest(large.entry, 32), { code: 'corrupt-state' });
});

test('Doctor recognizes an Electron ASAR runtime without creating profile or storage data', { skip: !electron }, async t => {
  const root = await fixture(t); const packed = await archive(root, '{"name":"@deepseek-ai/dsh","version":"0.2.1-rc.5"}');
  const report = await runDoctor({ home: root, runtimeRoot: packed.path });
  assert.equal(report.host.version, '0.2.1-rc.5');
  assert.equal(report.checks.find(check => check.id === 'host-version')?.status, 'pass');
  assert.equal(report.runtimeState, 'unverified');
  await assert.rejects(physical.access(join(root, 'profiles')), { code: 'ENOENT' });
  await assert.rejects(physical.access(join(root, 'archive-delete')), { code: 'ENOENT' });
});

test('Electron refuses archive links, virtual links and oversized containing archives', { skip: !electron }, async t => {
  const root = await fixture(t); const packed = await archive(root, '{"keep":true}', true);
  await assert.rejects(readHostManifest(join(packed.path, 'linked.json')), { code: 'corrupt-state' });
  if (process.platform !== 'win32') {
    const linked = join(root, 'linked.asar'); await symlink(packed.path, linked);
    await assert.rejects(readHostManifest(join(linked, 'manifest.json')), { code: 'corrupt-state' });
  }
  const before = await physical.readFile(packed.path);
  await physical.truncate(packed.path, 1024 * 1024 * 1024 + 1);
  await assert.rejects(readHostManifest(packed.entry), { code: 'corrupt-state' });
  // Restore the small fixture so cleanup never needs to retain a sparse image.
  await physical.writeFile(packed.path, before);
});
