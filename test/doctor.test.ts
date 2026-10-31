import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { PACKAGE_NAME, SUPPORTED_DSH_VERSION, SUPPORTED_DSH_VERSIONS, SUPPORTED_DSH_VERSION_LABEL } from '../src/contracts.js';
import { formatDoctorReport, runDoctor, type DoctorOptions, type DoctorReport } from '../src/doctor.js';
import { PLUGIN_VERSION } from '../src/version.js';

async function fixture(t: TestContext) {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'archive-doctor-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  const profile = join(home, 'profiles', 'desktop'); await mkdir(profile, { recursive: true });
  const profileFile = join(profile, 'package.json');
  const selected = { name: 'doctor-fixture', private: true, dependencies: { [PACKAGE_NAME]: 'synthetic-release' }, dsh: { profile: { bundles: ['keep-this-bundle', PACKAGE_NAME] } } };
  await writeFile(profileFile, JSON.stringify(selected));
  const installed = join(profile, 'node_modules', '@qwqbig', 'dsh-archive-delete'); await mkdir(join(installed, 'lib'), { recursive: true });
  await writeFile(join(installed, 'package.json'), JSON.stringify({ name: PACKAGE_NAME, version: PLUGIN_VERSION, type: 'module', exports: { './package.json': './package.json' } }));
  for (const name of ['lib/index.js', 'lib/client.js', 'lib/doctor.js', 'cordis.patch.yml']) await writeFile(join(installed, name), 'throw new Error("Doctor must never execute installed plugin code");');
  const runtime = join(home, 'runtime'); const hostPackage = join(runtime, 'node_modules', '@deepseek-ai', 'dsh'); await mkdir(hostPackage, { recursive: true });
  const hostManifest = join(hostPackage, 'package.json'); await writeFile(hostManifest, JSON.stringify({ name: '@deepseek-ai/dsh', version: SUPPORTED_DSH_VERSION }));
  const root = join(home, 'archive-delete');
  for (const area of ['trash', 'staging', 'receipts', 'operations']) await mkdir(join(root, area), { recursive: true, mode: 0o700 });
  const retained = join(root, 'trash', 'synthetic-marker'); await writeFile(retained, 'Must remain byte-identical.');
  const options: DoctorOptions = { home, runtimeRoot: runtime };
  return { home, profile, profileFile, selected, installed, runtime, hostPackage, hostManifest, root, retained, options };
}
const check = (report: DoctorReport, id: string) => report.checks.find(value => value.id === id)!;

test('doctor verifies one selected installation without executing code, writing probes or claiming live loading', async t => {
  const f = await fixture(t);
  const before = await readFile(f.profileFile, 'utf8'); const contents = await readdir(f.root); const trash = await readdir(join(f.root, 'trash'));
  const report = await runDoctor(f.options);
  assert.equal(report.ok, true);
  assert.equal(report.status, 'pass');
  assert.equal(report.runtimeState, 'unverified');
  assert.equal(report.host.source, 'explicit-runtime');
  assert.equal(report.host.version, SUPPORTED_DSH_VERSION);
  assert.equal(report.plugin.installedVersion, PLUGIN_VERSION);
  assert.match(report.note, /does not prove/);
  assert.equal(await readFile(f.profileFile, 'utf8'), before);
  assert.deepEqual(await readdir(f.root), contents);
  assert.deepEqual(await readdir(join(f.root, 'trash')), trash);
  assert.equal(await readFile(f.retained, 'utf8'), 'Must remain byte-identical.');
});

test('doctor distinguishes an installed but unregistered package from a stale bundle without a package', async t => {
  const f = await fixture(t);
  f.selected.dsh.profile.bundles = ['keep-this-bundle']; await writeFile(f.profileFile, JSON.stringify(f.selected));
  const inactive = await runDoctor(f.options);
  assert.equal(inactive.ok, false); assert.equal(check(inactive, 'bundle-registration').code, 'bundle-not-registered');
  assert.equal(check(inactive, 'installation').status, 'pass');
  f.selected.dsh.profile.bundles.push(PACKAGE_NAME); await writeFile(f.profileFile, JSON.stringify(f.selected)); await rm(f.installed, { recursive: true });
  const stale = await runDoctor(f.options);
  assert.equal(check(stale, 'bundle-registration').status, 'pass');
  assert.equal(check(stale, 'installation').code, 'package-missing-or-incomplete');
  assert.equal(await readFile(f.retained, 'utf8'), 'Must remain byte-identical.');
});

test('doctor identifies unsupported and unknown runtimes without substituting a plugin peer version', async t => {
  const f = await fixture(t);
  await writeFile(f.hostManifest, JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.1-rc.2' }));
  const wrong = await runDoctor(f.options);
  assert.equal(wrong.ok, false); assert.equal(check(wrong, 'host-version').code, 'host-version-mismatch');
  assert.match(check(wrong, 'host-version').message, /0\.2\.1-rc\.2.*0\.2\.1-rc\.3/);
  // The supported pinned peer has no evidentiary value for an unknown carrier.
  await writeFile(join(f.installed, 'package.json'), JSON.stringify({ name: PACKAGE_NAME, version: PLUGIN_VERSION, peerDependencies: { '@deepseek-ai/dsh': SUPPORTED_DSH_VERSION } }));
  const unknown = await runDoctor({ home: f.home });
  assert.equal(unknown.ok, false); assert.equal(check(unknown, 'host-version').status, 'warn');
  assert.equal(unknown.host.source, 'unresolved'); assert.match(check(unknown, 'host-version').message, /--runtime/);
});

test('doctor distinguishes an earlier complete package from a broken current package', async t => {
  const f = await fixture(t);
  const file = join(f.installed, 'package.json');
  const installed = JSON.parse(await readFile(file, 'utf8'));
  await writeFile(file, JSON.stringify({ ...installed, version: '0.1.1' }));
  await rm(join(f.installed, 'lib', 'doctor.js'));
  const older = await runDoctor(f.options);
  assert.equal(check(older, 'installation').code, 'doctor-version-differs');
  assert.equal(check(older, 'installation').status, 'warn');
  await writeFile(file, JSON.stringify(installed));
  const broken = await runDoctor(f.options);
  assert.equal(check(broken, 'installation').code, 'package-missing-or-incomplete');
  assert.equal(check(broken, 'installation').status, 'fail');
});

test('doctor accepts the explicit DSH package directory as well as its runtime container', async t => {
  const f = await fixture(t);
  const report = await runDoctor({ ...f.options, runtimeRoot: f.hostPackage });
  assert.equal(report.ok, true); assert.equal(report.host.manifest, f.hostManifest);
});

test('doctor treats absent storage as incomplete initialization and creates no directories', async t => {
  const f = await fixture(t); await rm(f.root, { recursive: true });
  const before = await readdir(f.home);
  const report = await runDoctor(f.options);
  assert.equal(report.ok, false); assert.equal(report.status, 'warn');
  assert.equal(check(report, 'storage').code, 'storage-not-initialized');
  assert.equal(check(report, 'trash-writable').status, 'warn');
  assert.deepEqual(await readdir(f.home), before);
});

test('doctor uses only the explicitly selected profile and rejects profile traversal', async t => {
  const f = await fixture(t);
  const web = join(f.home, 'profiles', 'web'); await mkdir(web); await writeFile(join(web, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: [] } } }));
  const report = await runDoctor({ ...f.options, profile: 'web' });
  assert.equal(report.profile.name, 'web'); assert.equal(check(report, 'bundle-registration').code, 'bundle-not-registered');
  assert.equal(check(report, 'installation').status, 'fail');
  await assert.rejects(runDoctor({ ...f.options, profile: '../desktop' }), /--profile/);
  await assert.rejects(runDoctor({ ...f.options, home: 'relative' }), /--home/);
  await assert.rejects(runDoctor({ ...f.options, runtimeRoot: 'relative' }), /--runtime/);
});

test('doctor refuses unsafe trash links and leaves the target untouched', async t => {
  const f = await fixture(t); const trash = join(f.root, 'trash'); await rm(trash, { recursive: true });
  const external = join(f.home, 'retained-external'); await mkdir(external); await writeFile(join(external, 'keep'), 'external content');
  await symlink(external, trash, process.platform === 'win32' ? 'junction' : 'dir');
  const report = await runDoctor(f.options);
  assert.equal(report.ok, false); assert.equal(check(report, 'storage').code, 'storage-unsafe');
  assert.notEqual(check(report, 'trash-writable').status, 'pass'); assert.equal(await readFile(join(external, 'keep'), 'utf8'), 'external content');
});

test('doctor reports denied write access without writing a probe', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async t => {
  const f = await fixture(t); const trash = join(f.root, 'trash'); await chmod(trash, 0o500);
  try {
    const report = await runDoctor(f.options);
    assert.equal(check(report, 'storage').status, 'pass'); assert.equal(check(report, 'trash-writable').code, 'trash-not-writable'); assert.equal(report.ok, false);
  } finally { await chmod(trash, 0o700); }
});

test('doctor diagnoses corrupt manifests and incomplete precompiled artifacts', async t => {
  const f = await fixture(t); await writeFile(f.profileFile, '{invalid-json'); await rm(join(f.installed, 'lib', 'client.js'));
  const report = await runDoctor(f.options);
  assert.equal(check(report, 'profile').code, 'profile-unreadable');
  assert.equal(check(report, 'bundle-registration').code, 'bundle-list-invalid');
  assert.equal(check(report, 'installation').status, 'fail');
});

test('doctor output follows the selected language and retains stable machine fields', async t => {
  const f = await fixture(t); const report = await runDoctor({ ...f.options, language: 'zh' });
  const formatted = formatDoctorReport(report);
  assert.match(formatted, /只读自检/); assert.match(formatted, /无法证明/);
  assert.equal(report.runtimeState, 'unverified'); assert.equal(report.schemaVersion, 1);
  assert.match(check(report, 'bundle-registration').message, /登记一次/);
});

test('doctor admits each declared host exactly and reports the actual runtime and supported list', async t => {
  const f = await fixture(t);
  for (const hostVersion of SUPPORTED_DSH_VERSIONS) for (const language of ['en', 'zh'] as const) {
    await writeFile(f.hostManifest, JSON.stringify({ name: '@deepseek-ai/dsh', version: hostVersion }));
    const report = await runDoctor({ ...f.options, language });
    assert.equal(report.ok, true);
    assert.equal(report.host.version, hostVersion);
    assert.equal(check(report, 'host-version').status, 'pass');
    assert.deepEqual(report.supportedDshVersions, ['0.2.1-rc.3', '0.2.1-rc.5']);
    assert.equal(report.targetDshVersion, SUPPORTED_DSH_VERSION_LABEL);
    for (const supported of SUPPORTED_DSH_VERSIONS) assert.ok(check(report, 'host-version').message.includes(supported));
    assert.equal(report.runtimeState, 'unverified');
  }
  for (const hostVersion of ['0.2.1-rc.4', '0.2.1-rc.6', '0.2.1', 'unknown']) {
    await writeFile(f.hostManifest, JSON.stringify({ name: '@deepseek-ai/dsh', version: hostVersion }));
    const report = await runDoctor(f.options);
    assert.equal(report.ok, false);
    assert.equal(check(report, 'host-version').code, 'host-version-mismatch');
    assert.equal(report.host.version, hostVersion);
  }
  assert.equal(await readFile(f.retained, 'utf8'), 'Must remain byte-identical.');
});
