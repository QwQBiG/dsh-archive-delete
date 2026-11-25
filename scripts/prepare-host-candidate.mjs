import assert from 'node:assert/strict';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { isExactDshVersion } from './check-host-updates.mjs';

const versionsFile = new URL('../src/host-versions.json', import.meta.url);
const manifestFile = new URL('../package.json', import.meta.url);
const supported = JSON.parse(await readFile(versionsFile, 'utf8'));
const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
const peers = ['@deepseek-ai/dsh-app-boot', '@deepseek-ai/dsh-home-paths'];
const currentRange = supported.join(' || ');
assert.equal(manifest.engines.dsh, currentRange);
for (const peer of peers) assert.equal(manifest.peerDependencies[peer], currentRange);

const candidate = process.env.DSH_CANDIDATE_VERSION;
if (candidate && !isExactDshVersion(candidate)) throw new Error('Use an exact DSH version for compatibility testing.');

if (process.argv[2] === 'matrix') {
  const versions = JSON.stringify(candidate ? [candidate] : supported);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `versions=${versions}\n`);
  else console.log(versions);
} else {
  assert.equal(process.argv[2], 'admit');
  assert.ok(candidate, 'Set DSH_CANDIDATE_VERSION to test a candidate in this disposable checkout.');
  if (!supported.includes(candidate)) {
    const versions = [...supported, candidate];
    const range = versions.join(' || ');
    manifest.engines.dsh = range;
    for (const peer of peers) manifest.peerDependencies[peer] = range;
    await writeFile(versionsFile, `${JSON.stringify(versions, null, 2)}\n`);
    await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  }
}
