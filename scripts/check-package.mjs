import { readFile, access } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import assert from 'node:assert/strict';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const { PACKAGE_NAME, SUPPORTED_DSH_VERSIONS } = await tsImport('../src/contracts.ts', import.meta.url);
const { supportedPackageDshVersions } = await tsImport('../src/update-source.ts', import.meta.url);
if (pkg.name !== PACKAGE_NAME || pkg.engines.dsh !== SUPPORTED_DSH_VERSIONS.join(' || ')) throw new Error('Package identity or compatibility gate drifted.');
assert.deepEqual(supportedPackageDshVersions(pkg), SUPPORTED_DSH_VERSIONS, 'Declared and tested DSH versions must agree.');
if (!pkg.files.includes('docs')) throw new Error('The installable package must retain the linked documentation.');
for (const name of Object.keys(pkg.peerDependencies ?? {})) {
  if (pkg.peerDependenciesMeta?.[name]?.optional !== true) throw new Error(`Host-provided peer ${name} must be optional.`);
}
if (pkg.scripts?.postinstall) throw new Error('Installation must not require a lifecycle build or automatic profile modification.');
if (pkg.bin?.['dsh-archive-delete-doctor'] !== './lib/doctor.js') throw new Error('The read-only doctor command is missing.');
for (const path of ['lib/index.js', 'lib/client.js', 'lib/doctor.js', 'cordis.patch.yml', 'LICENSE', 'README.md', 'README.zh-CN.md']) await access(join(root, path));
if (!(await readFile(join(root, 'lib/doctor.js'), 'utf8')).startsWith('#!/usr/bin/env node')) throw new Error('Doctor must retain its executable entry point.');
const host = await import(new URL('../lib/index.js', import.meta.url));
if (typeof host.apply !== 'function' || !host.inject) throw new Error('Host plugin export contract is invalid.');
const client = await readFile(join(root, 'lib/client.js'), 'utf8');
if (!client.includes('window.__ModuleLoader__.load') || !client.includes(pkg.name) || !client.includes('startClient')) throw new Error('Client loader contract is invalid.');
if (client.includes('react.production.min.js') || client.includes('ReactCurrentDispatcher')) throw new Error('A second React runtime was bundled.');
console.log('Checked installable bundle contracts / 已检查可安装插件契约');
