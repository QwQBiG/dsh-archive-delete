import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createGithubUpdateSource, supportedPackageDshVersions, inspectUpdatePackageCompatibility } from '../src/update-source.ts';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const directory = resolve(process.argv[2] ?? 'artifacts');
const name = `${pkg.name.replace(/^@/, '').replaceAll('/', '-')}-${pkg.version}.tgz`;
const bytes = await readFile(join(directory, name));
const digest = createHash('sha256').update(bytes).digest('hex');
assert.equal(await readFile(join(directory, `${name}.sha256`), 'utf8'), `${digest}  ${name}\n`, 'The public checksum must match the exact release package.');
const hosts = supportedPackageDshVersions(pkg);
const packed = await inspectUpdatePackageCompatibility(bytes, pkg.version, pkg.engines.dsh);
assert.equal(packed.primaryDshVersion, pkg.engines.dsh); assert.deepEqual(packed.supportedDshVersions.toSorted(), hosts.toSorted());
const metadata = await Promise.all(hosts.map(async hostVersion => {
  const metaName = name.replace(/\.tgz$/, hostVersion === pkg.engines.dsh ? '.update.json' : `.dsh-${hostVersion}.update.json`);
  const data = await readFile(join(directory, metaName)); const parsed = JSON.parse(data.toString('utf8'));
  assert.equal(parsed.requiredDshVersion, hostVersion, 'Each metadata asset must target its exact host.');
  assert.equal(parsed.asset?.sha256, digest, 'Update metadata and the public checksum must agree.');
  assert.equal(parsed.asset?.bytes, bytes.length, 'Update metadata must describe the exact release package.');
  return { hostVersion, metaName, data };
}));
const base = 'https://github.com/QwQBiG/dsh-archive-delete/releases';
const assetUrl = `${base}/download/v${pkg.version}/${name}`;
const responses = new Map(metadata.map(item => [`${base}/download/v${pkg.version}/${item.metaName}`, item.data]));
const release = { id: 1, draft: false, prerelease: false, tag_name: `v${pkg.version}`, published_at: '2026-10-29T00:00:00Z',
  html_url: `${base}/tag/v${pkg.version}`, body: 'Package release verification', assets: [
    { id: 2, name, state: 'uploaded', size: bytes.length, digest: `sha256:${digest}`, browser_download_url: assetUrl },
    ...metadata.map((item, index) => ({ id: index + 3, name: item.metaName, state: 'uploaded', size: item.data.length,
      browser_download_url: `${base}/download/v${pkg.version}/${item.metaName}` })),
  ] };
// Exercise each supported host against the same packed bytes and complete release.
const pins = new Set();
for (const hostVersion of hosts) {
  const source = createGithubUpdateSource({ currentVersion: '0.0.0', hostVersion, platform: process.platform,
    fetch: async url => {
      if (url === 'https://api.github.com/repos/QwQBiG/dsh-archive-delete/releases?per_page=20') return Response.json([release]);
      if (url === 'https://api.github.com/repos/QwQBiG/dsh-archive-delete/releases/1') return Response.json(release);
      if (responses.has(url)) return new Response(responses.get(url));
      if (url === assetUrl) return new Response(bytes);
      throw new Error('Unexpected release request');
    } });
  const check = await source.check(); assert.equal(check.availability, 'available'); assert.ok(check.pinned);
  assert.equal(check.candidate?.requiredDshVersion, hostVersion); assert.ok(!pins.has(check.candidate.id)); pins.add(check.candidate.id);
  await source.revalidate(check.pinned); assert.deepEqual(await source.download(check.pinned), bytes);
}
console.log(`Verified updater discovery and package admission / 已验证更新发现与发行包准入: ${pkg.version} (${hosts.join(', ')})`);
