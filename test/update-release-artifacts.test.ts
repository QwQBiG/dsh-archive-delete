import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import { SUPPORTED_DSH_VERSIONS } from '../src/contracts.js';

const exec = promisify(execFile);
const root = new URL('../', import.meta.url);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const name = `qwqbig-dsh-archive-delete-${pkg.version}.tgz`;
function packed(hook = false, requirement = pkg.engines.dsh): Buffer {
  const manifest = { ...pkg, engines: { ...pkg.engines, dsh: requirement }, ...(hook ? { scripts: { postinstall: 'unexpected install hook' } } : {}) };
  const parts: Buffer[] = [];
  for (const [path, content] of [['package/package.json', JSON.stringify(manifest)], ['package/cordis.patch.yml', '- insert: archive-delete'],
    ['package/lib/index.js', 'export const apply = () => {};'], ['package/lib/client.js', 'export const startClient = () => {};']]) {
    const data = Buffer.from(content!); const header = Buffer.alloc(512);
    header.write(path!); header.write('0000644\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116);
    header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124); header.write('00000000000\0', 136);
    header.fill(32, 148, 156); header.write('0', 156); header.write('ustar\0', 257); header.write('00', 263);
    header.write(`${header.reduce((sum, value) => sum + value, 0).toString(8).padStart(6, '0')}\0 `, 148);
    parts.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...parts, Buffer.alloc(1024)]));
}

test('release generation rejects a package that installed updater admission would refuse', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'archive-release-admission-')); t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, name), packed(true));
  await assert.rejects(exec(process.execPath, ['scripts/release-artifacts.mjs', directory], { cwd: root }));
  assert.deepEqual(await readdir(directory), [name], 'invalid packages must not receive public checksum or update metadata');
});

test('release package checker binds the human checksum and updater metadata to the same bytes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'archive-release-checksum-')); t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, name), packed());
  await exec(process.execPath, ['scripts/release-artifacts.mjs', directory], { cwd: root });
  const metadataNames = SUPPORTED_DSH_VERSIONS.map((host, index) =>
    name.replace(/\.tgz$/, index === 0 ? '.update.json' : `.dsh-${host}.update.json`));
  assert.deepEqual((await readdir(directory)).sort(), [name, `${name}.sha256`, ...metadataNames].sort());
  const metadata = await Promise.all(metadataNames.map(async file => JSON.parse(await readFile(join(directory, file), 'utf8'))));
  const [primary, secondary] = metadata;
  for (const [index, item] of metadata.entries()) {
    assert.equal(item.requiredDshVersion, SUPPORTED_DSH_VERSIONS[index]);
    assert.deepEqual(item.asset, primary.asset, 'every supported host installs the same packed bytes');
    assert.deepEqual(Object.keys(item).sort(), ['schema', 'packageName', 'version', 'requiredDshVersion', 'platforms', 'asset'].sort(), 'metadata retains an exact host gate');
  }
  await exec(process.execPath, ['--import', 'tsx', 'scripts/check-update-package.mjs', directory], { cwd: root });
  const checksum = await readFile(join(directory, `${name}.sha256`));
  await writeFile(join(directory, `${name}.sha256`), `${'ab'.repeat(32)}  ${name}\n`);
  await assert.rejects(exec(process.execPath, ['--import', 'tsx', 'scripts/check-update-package.mjs', directory], { cwd: root }));
  await writeFile(join(directory, `${name}.sha256`), checksum);
  const metaPath = join(directory, metadataNames[0]!);
  const meta = JSON.parse(await readFile(metaPath, 'utf8')); meta.asset.sha256 = 'ab'.repeat(32); await writeFile(metaPath, JSON.stringify(meta));
  await assert.rejects(exec(process.execPath, ['--import', 'tsx', 'scripts/check-update-package.mjs', directory], { cwd: root }));
  await writeFile(metaPath, JSON.stringify(primary));
  secondary.requiredDshVersion = primary.requiredDshVersion; await writeFile(join(directory, metadataNames[1]!), JSON.stringify(secondary));
  await assert.rejects(exec(process.execPath, ['--import', 'tsx', 'scripts/check-update-package.mjs', directory], { cwd: root }));
});

test('release generation validates every declared host before writing metadata', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'archive-release-hosts-')); t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, name), packed(false, '0.2.1-rc.3'));
  await assert.rejects(exec(process.execPath, ['scripts/release-artifacts.mjs', directory], { cwd: root }));
  assert.deepEqual(await readdir(directory), [name]);
  await writeFile(join(directory, name), packed(false, '0.2.1-rc.5'));
  await assert.rejects(exec(process.execPath, ['scripts/release-artifacts.mjs', directory], { cwd: root }));
  assert.deepEqual(await readdir(directory), [name], 'the packed engine must agree with the release manifest');
});
