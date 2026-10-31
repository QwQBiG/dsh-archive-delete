import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createGithubUpdateSource } from '../src/update-source.ts';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const directory = resolve(process.argv[2] ?? 'artifacts');
const name = `${pkg.name.replace(/^@/, '').replaceAll('/', '-')}-${pkg.version}.tgz`;
const bytes = await readFile(join(directory, name));
const metaName = name.replace(/\.tgz$/, '.update.json'); const meta = await readFile(join(directory, metaName));
const digest = createHash('sha256').update(bytes).digest('hex');
assert.equal(await readFile(join(directory, `${name}.sha256`), 'utf8'), `${digest}  ${name}\n`, 'The public checksum must match the exact release package.');
const metadata = JSON.parse(meta.toString('utf8'));
assert.equal(metadata.asset?.sha256, digest, 'Update metadata and the public checksum must agree.');
assert.equal(metadata.asset?.bytes, bytes.length, 'Update metadata must describe the exact release package.');
const base = 'https://github.com/QwQBiG/dsh-archive-delete/releases';
const assetUrl = `${base}/download/v${pkg.version}/${name}`; const metaUrl = `${base}/download/v${pkg.version}/${metaName}`;
const release = { id: 1, draft: false, prerelease: false, tag_name: `v${pkg.version}`, published_at: '2026-10-29T00:00:00Z',
  html_url: `${base}/tag/v${pkg.version}`, body: 'Package release verification', assets: [
    { id: 2, name, state: 'uploaded', size: bytes.length, digest: `sha256:${digest}`, browser_download_url: assetUrl },
    { id: 3, name: metaName, state: 'uploaded', size: meta.length, browser_download_url: metaUrl },
  ] };
// Exercise the same discovery, pin, checksum and archive admission used by an
// already installed updater. Network responses are local fixtures, never GitHub.
const source = createGithubUpdateSource({ currentVersion: '0.0.0', hostVersion: pkg.engines.dsh, platform: process.platform,
  fetch: async url => {
    if (url === 'https://api.github.com/repos/QwQBiG/dsh-archive-delete/releases?per_page=20') return Response.json([release]);
    if (url === 'https://api.github.com/repos/QwQBiG/dsh-archive-delete/releases/1') return Response.json(release);
    if (url === metaUrl) return new Response(meta);
    if (url === assetUrl) return new Response(bytes);
    throw new Error('Unexpected release request');
  } });
const check = await source.check(); assert.equal(check.availability, 'available'); assert.ok(check.pinned);
await source.revalidate(check.pinned); assert.deepEqual(await source.download(check.pinned), bytes);
console.log(`Verified updater discovery and package admission / 已验证更新发现与发行包准入: ${pkg.version}`);
