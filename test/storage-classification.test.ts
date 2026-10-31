import assert from 'node:assert/strict';
import { link, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { classifyStorageFile, FILE_KINDS, preferredFileKind, type FileKind } from '../src/storage-classification.js';
import { scanStorage, type UsageCategory } from '../src/storage-usage.js';

test('relative directory hints take exclusive, transparent precedence over file extensions', () => {
  const cases: readonly [string, FileKind][] = [
    ['node_modules/example/dist/index.js', 'dependencies'], ['vendor/sdk/logo.png', 'dependencies'],
    ['.venv/lib/python/site-packages/a.py', 'dependencies'], ['Pods/Library/README.md', 'dependencies'],
    ['node_modules/example/.git/objects/pack', 'version-control'], ['.hg/store/records', 'version-control'],
    ['dist/reports/report.pdf', 'build'], ['build/logs/run.log', 'build'], ['.next/cache/entry.json', 'build'],
    ['target/debug/app', 'build'], ['out/assets/image.png', 'build'], ['src/__pycache__/main.pyc', 'build'],
    ['logs/notes.txt', 'logs'], ['.svn/entries', 'version-control'],
    [String.raw`src\node_modules\package\dist\image.png`, 'dependencies'],
    [String.raw`Vendor\SDK\.Git\HEAD`, 'version-control'],
    ['src/build.ts', 'code'], ['assets/build.png', 'media'], ['src/vendor.ts', 'code'], ['buildings/guide.md', 'documents'],
    ['src/node_modules', 'other'], ['src/.git', 'other'],
  ];
  for (const [path, expected] of cases) assert.equal(classifyStorageFile(path), expected, path);
});

test('extension and conventional-name classification is case insensitive and does not infer AI origin', () => {
  const cases: readonly [string, FileKind][] = [
    ['session.v4.jsonl.zstd', 'logs'], ['output.LOG.GZ', 'logs'], ['trace.ndjson', 'logs'],
    ['image.HEIC', 'media'], ['voice.wav', 'media'], ['demo.MP4', 'media'], ['diagram.svg', 'media'],
    ['release.tar.gz', 'archives'], ['package.WHL', 'archives'], ['backup.7z', 'archives'],
    ['src/main.tsx', 'code'], ['package.json', 'code'], ['pnpm-lock.yaml', 'code'], ['.env.local', 'code'],
    ['Dockerfile', 'code'], ['CMakeLists.txt', 'code'], ['requirements.txt', 'code'], ['.gitignore', 'code'],
    ['README', 'documents'], ['LICENSE', 'documents'], ['plan.pdf', 'documents'], ['table.xlsx', 'documents'],
    ['ai-output.tmp', 'other'], ['garbage.bin', 'other'], ['AI/old-final.pdf', 'documents'],
    ['cache-data', 'other'], ['model.safetensors', 'other'], ['search.sqlite', 'other'],
    ['log', 'other'], ['pdf', 'other'], ['ts', 'other'],
  ];
  for (const [path, expected] of cases) assert.equal(classifyStorageFile(path), expected, path);
  assert.equal(new Set(FILE_KINDS).size, FILE_KINDS.length);
});

test('alias attribution precedence is stable regardless of observation order', () => {
  for (const first of FILE_KINDS) for (const second of FILE_KINDS) {
    assert.equal(preferredFileKind(first, second), preferredFileKind(second, first));
    assert.ok(FILE_KINDS.includes(preferredFileKind(first, second)));
  }
  assert.equal(preferredFileKind('documents', 'dependencies'), 'dependencies');
  assert.equal(preferredFileKind('build', 'version-control'), 'version-control');
});

async function fixture(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'storage-classification-')));
  t.after(() => rm(root, { recursive: true, force: true })); return root;
}
async function file(root: string, path: string, bytes: number) {
  const destination = join(root, path); await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, Buffer.alloc(bytes, 81)); return destination;
}
function assertBreakdown(category: UsageCategory) {
  assert.ok(category.fileKinds);
  assert.equal(category.fileKinds.reduce((sum, item) => sum + item.fileBytes, 0), category.fileBytes ?? 0);
  assert.equal(category.fileKinds.reduce((sum, item) => sum + item.fileCount, 0), category.uniqueFileCount);
  assert.equal(new Set(category.fileKinds.map(item => item.kind)).size, category.fileKinds.length);
  assert.ok(category.largestFiles.every(item => item.source === 'unknown' && FILE_KINDS.includes(item.kind!)));
}

test('workspace type totals partition measured logical bytes without opening or changing file content', async t => {
  const root = await fixture(t);
  const inputs: readonly [string, number, FileKind][] = [
    ['node_modules/example/dist/index.js', 11, 'dependencies'], ['.venv/lib/main.py', 13, 'dependencies'],
    ['.git/objects/object', 17, 'version-control'], ['dist/report.pdf', 19, 'build'],
    ['logs/notes.txt', 23, 'logs'], ['assets/image.png', 29, 'media'], ['backup.tgz', 31, 'archives'],
    ['src/main.ts', 37, 'code'], ['docs/guide.md', 41, 'documents'], ['ai-output.bin', 43, 'other'],
    ['empty.txt', 0, 'documents'],
  ];
  for (const [path, bytes] of inputs) await file(root, path, bytes);
  const before = await readFile(join(root, 'ai-output.bin'));
  const result = await scanStorage([{ id: 'workspace', kind: 'workspace', readOnly: true, path: root }]);
  assert.equal(result.complete, true); const category = result.categories[0]!; assertBreakdown(category);
  for (const kind of FILE_KINDS) {
    const expected = inputs.filter(input => input[2] === kind);
    assert.deepEqual(category.fileKinds!.find(item => item.kind === kind), {
      kind, fileBytes: expected.reduce((sum, input) => sum + input[1], 0), fileCount: expected.length,
    });
  }
  for (const listed of category.largestFiles) assert.equal(listed.kind, inputs.find(input => input[0] === listed.relativePath)![2]);
  assert.deepEqual(await readFile(join(root, 'ai-output.bin')), before);
});

test('hard-link aliases contribute to exactly one kind while roots retain separate overlapping breakdowns', async t => {
  const root = await fixture(t); const original = await file(root, 'docs/report.md', 13);
  await mkdir(join(root, 'node_modules', 'fixture'), { recursive: true });
  await link(original, join(root, 'node_modules', 'fixture', 'alias.bin'));
  const result = await scanStorage([
    { id: 'workspace', kind: 'workspace', readOnly: true, path: root },
    { id: 'documents', kind: 'other', readOnly: true, path: join(root, 'docs') },
  ]);
  assert.equal(result.complete, true); assert.equal(result.fileBytes, 13); assert.equal(result.uniqueFileCount, 1);
  assert.equal(result.referencedBytes, 39); assert.ok(result.duplicateHardlinks > 0); assert.ok(result.duplicatePaths > 0);
  const whole = result.categories[0]!; const nested = result.categories[1]!;
  assertBreakdown(whole); assertBreakdown(nested);
  assert.deepEqual(whole.fileKinds, [{ kind: 'dependencies', fileBytes: 13, fileCount: 1 }]);
  assert.deepEqual(nested.fileKinds, [{ kind: 'documents', fileBytes: 13, fileCount: 1 }]);
  assert.deepEqual(whole.overlaps, ['documents']); assert.deepEqual(nested.overlaps, ['workspace']);
  assert.equal(whole.largestFiles.find(item => item.relativePath === 'docs/report.md')!.kind, 'documents');
  assert.equal(whole.largestFiles.find(item => item.relativePath.includes('node_modules'))!.kind, 'dependencies');
});

test('partial, cancelled and unavailable scans keep classifications limited to measured files', async t => {
  const root = await fixture(t); await file(root, 'image.png', 7); await file(root, 'note.md', 11);
  const controller = new AbortController();
  const partial = await scanStorage([{ id: 'workspace', kind: 'workspace', readOnly: true, path: root }], {
    signal: controller.signal, yieldEvery: 1, onProgress: progress => { if (progress.files > 0) controller.abort(); },
  });
  assert.equal(partial.complete, false); assert.equal(partial.uniqueFileCount, 1); assertBreakdown(partial.categories[0]!);
  const missing = await scanStorage([{ id: 'missing', kind: 'workspace', readOnly: true, path: join(root, 'absent') }]);
  assert.equal(missing.categories[0]!.fileBytes, null); assert.deepEqual(missing.categories[0]!.fileKinds, []);
  const timed = await scanStorage([{ id: 'workspace', kind: 'workspace', readOnly: true, path: root }], { maxDurationMs: 0 });
  assert.equal(timed.categories[0]!.fileBytes, null); assert.deepEqual(timed.categories[0]!.fileKinds, []);
});
