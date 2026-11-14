import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createArchiveApi } from '../src/client.js';
import { classifyStorageFile } from '../src/storage-classification.js';
import { scanStorage } from '../src/storage-usage.js';
import type { StorageOverview } from '../src/contracts.js';

async function fixture(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'storage-relative-filenames-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
function api(result: StorageOverview) {
  return createArchiveApi(async () => Response.json({ ok: true, value: result }), 'http://127.0.0.1/');
}
async function overview(root: string): Promise<StorageOverview> {
  return { ...await scanStorage([{ id: 'workspace', kind: 'workspace', readOnly: true, path: root }]),
    scope: 'workspace', workspaceId: 'project', workspaces: [{ id: 'project', title: 'Project' }] };
}

test('valid POSIX colon and backslash filenames survive a real scanner-to-client round trip', { skip: process.platform === 'win32' }, async t => {
  const root = await fixture(t);
  const names = ['C:report.txt', String.raw`\notes.txt`, String.raw`folder\..\note.md`, String.raw`node_modules\memo.txt`];
  for (const name of names) await writeFile(join(root, name), 'sample');
  const result = await overview(root); assert.equal(result.complete, true);
  const received = await api(result).storage!('project');
  assert.equal(received.fileBytes, names.length * 6); assert.equal(received.fileCount, names.length);
  assert.deepEqual(received.categories[0]!.largestFiles.map(file => file.relativePath).sort(), names.toSorted());
});

test('POSIX directory names that look like drive prefixes remain relative wire paths', { skip: process.platform === 'win32' }, async t => {
  const root = await fixture(t); await mkdir(join(root, 'C:')); await writeFile(join(root, 'C:', 'report.txt'), 'sample');
  const received = await api(await overview(root)).storage!('project');
  assert.equal(received.categories[0]!.largestFiles[0]!.relativePath, 'C:/report.txt');
  assert.deepEqual(received.categories[0]!.directories, [{ relativePath: 'C:', fileBytes: 6, fileCount: 1 }]);
});

test('native POSIX classification preserves literal backslashes while real folders retain their meaning', { skip: process.platform === 'win32' }, async t => {
  const root = await fixture(t); await writeFile(join(root, String.raw`node_modules\memo.txt`), 'sample');
  await mkdir(join(root, 'node_modules')); await writeFile(join(root, 'node_modules', 'index.js'), 'source');
  const result = await overview(root); const category = result.categories[0]!;
  assert.equal(category.largestFiles.find(file => file.relativePath === String.raw`node_modules\memo.txt`)!.kind, 'documents');
  assert.equal(category.largestFiles.find(file => file.relativePath === 'node_modules/index.js')!.kind, 'dependencies');
  assert.deepEqual(category.fileKinds!.toSorted((a, b) => a.kind.localeCompare(b.kind)), [
    { kind: 'dependencies', fileBytes: 6, fileCount: 1 }, { kind: 'documents', fileBytes: 6, fileCount: 1 },
  ]);
});

test('wire validation still rejects forward traversal, forward absolute paths, empty paths and NUL', async t => {
  const root = await fixture(t); await writeFile(join(root, 'report.txt'), 'sample');
  const result = await overview(root);
  for (const path of ['../escape', 'nested/../escape', '/absolute', '', 'bad\0name']) {
    for (const location of ['largestFiles', 'directories', 'issues'] as const) {
      const malformed = structuredClone(result); const category = malformed.categories[0]!;
      if (location === 'largestFiles') category.largestFiles[0]!.relativePath = path;
      if (location === 'directories') category.directories[0]!.relativePath = path;
      if (location === 'issues') category.issues = [{ code: 'entry-unreadable', relativePath: path }];
      await assert.rejects(api(malformed).storage!('project'), /unexpected response/, `${location}: ${JSON.stringify(path)}`);
    }
  }
});

test('ordinary slash wire paths and portable Windows classification remain supported', async t => {
  const root = await fixture(t); await mkdir(join(root, 'docs')); await writeFile(join(root, 'docs', 'report.txt'), 'sample');
  const received = await api(await overview(root)).storage!('project');
  assert.equal(received.categories[0]!.largestFiles[0]!.relativePath, 'docs/report.txt');
  assert.equal(classifyStorageFile(String.raw`node_modules\example\index.js`), 'dependencies');
  assert.equal(classifyStorageFile('node_modules/example/index.js'), 'dependencies');
});
