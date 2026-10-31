import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/prepare-native-runtime.mjs', import.meta.url));
async function fixture(t: TestContext, version = '0.2.1-rc.3') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'archive-native-selector-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = join(root, 'existing-runtime');
  const manifest = join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'package.json');
  await mkdir(dirname(manifest), { recursive: true });
  await writeFile(manifest, JSON.stringify({ name: '@deepseek-ai/dsh', version }));
  const envFile = join(root, 'github-env');
  const env: NodeJS.ProcessEnv = { ...process.env, CI: 'false', DSH_RUNTIME_ROOT: runtime, DSH_TEST_VERSION: undefined,
    GITHUB_ENV: envFile, RUNNER_TEMP: root, DSH_NPM_CLI: undefined };
  return { root, runtime, manifest, envFile, env };
}

test('native runtime selector reuses only the requested declared SDK and defaults to the primary host', async t => {
  const f = await fixture(t);
  const primary = await execute(process.execPath, [script], { env: f.env });
  assert.match(primary.stdout, /DSH 0\.2\.1-rc\.3/);
  await writeFile(f.manifest, JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.1-rc.5' }));
  const newer = await execute(process.execPath, [script], { env: { ...f.env, DSH_TEST_VERSION: '0.2.1-rc.5' } });
  assert.match(newer.stdout, /DSH 0\.2\.1-rc\.5/);
  assert.ok((await readFile(f.envFile, 'utf8')).includes(`DSH_RUNTIME_ROOT=${f.runtime}`));
});

test('local runtime mismatch and undeclared versions fail without invoking an installer', async t => {
  const f = await fixture(t, '0.2.1-rc.5');
  await assert.rejects(execute(process.execPath, [script], { env: f.env }), /Expected DSH 0\.2\.1-rc\.3; found 0\.2\.1-rc\.5/);
  await assert.rejects(execute(process.execPath, [script], { env: { ...f.env, DSH_TEST_VERSION: '0.2.1-rc.4' } }), /Unsupported DSH_TEST_VERSION/);
  await assert.rejects(execute(process.execPath, [script], { env: { ...f.env, DSH_RUNTIME_ROOT: 'relative/runtime' } }), /must be an absolute runtime directory/);
  assert.equal(JSON.parse(await readFile(f.manifest, 'utf8')).version, '0.2.1-rc.5');
  await assert.rejects(readFile(f.envFile), { code: 'ENOENT' });
});

test('CI runtime mismatch installs the requested exact SDK into a new isolated root', { skip: !['darwin', 'win32'].includes(process.platform) }, async t => {
  const f = await fixture(t); const capture = join(f.root, 'installer-arguments.json'); const npm = join(f.root, 'synthetic-npm.mjs');
  await writeFile(npm, `import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const args = process.argv.slice(2);
const root = args[args.indexOf('--prefix') + 1];
const version = args.find(value => value.startsWith('@deepseek-ai/dsh@')).slice('@deepseek-ai/dsh@'.length);
const directory = join(root, 'node_modules', '@deepseek-ai', 'dsh');
await mkdir(directory, {recursive:true});
await writeFile(join(directory, 'package.json'), JSON.stringify({name:'@deepseek-ai/dsh',version}));
await writeFile(process.env.DSH_SELECTOR_CAPTURE, JSON.stringify({args,root}));
`);
  await execute(process.execPath, [script], { env: { ...f.env, CI: 'true', DSH_TEST_VERSION: '0.2.1-rc.5', DSH_NPM_CLI: npm, DSH_SELECTOR_CAPTURE: capture } });
  const installed = JSON.parse(await readFile(capture, 'utf8'));
  assert.ok(installed.args.includes('@deepseek-ai/dsh@0.2.1-rc.5'));
  assert.notEqual(installed.root, f.runtime);
  assert.equal(dirname(installed.root), f.root);
  assert.equal(JSON.parse(await readFile(f.manifest, 'utf8')).version, '0.2.1-rc.3');
  assert.ok((await readFile(f.envFile, 'utf8')).includes(`DSH_RUNTIME_ROOT=${installed.root}`));
});
