import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { getStorageSources, type HostContext } from '../src/dsh-adapter.js';
import { scanStorage } from '../src/storage-usage.js';

async function fixture(t: TestContext, version = '0.2.1-rc.5') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'storage-search-sidecars-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'host'); await mkdir(home);
  const anchor = join(root, 'host-package.json');
  await writeFile(anchor, JSON.stringify({ name: '@deepseek-ai/dsh', version }));
  const ctx: HostContext = { dshHomePath: () => home, profileContext: { installAnchor: anchor } };
  return { root, home, ctx };
}

test('search inventory includes an active SQLite WAL and shared-memory file outside DSH home', async t => {
  const f = await fixture(t); const path = join(f.root, 'search.sqlite');
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA journal_mode = WAL; CREATE TABLE sample (value TEXT); INSERT INTO sample VALUES (\'synthetic\')');
    f.ctx.sessionQuery = { config: { path } };
    const expected = (await Promise.all([path, `${path}-wal`, `${path}-shm`].map(async file => (await lstat(file)).size))).reduce((sum, size) => sum + size, 0);
    const result = await scanStorage((await getStorageSources(f.ctx)).filter(root => root.id === 'search'));
    assert.equal(result.complete, true);
    assert.equal(result.fileBytes, expected);
    assert.equal(result.fileCount, 3);
    assert.deepEqual(result.categories[0]!.largestFiles.map(file => file.relativePath).sort(), ['search.sqlite', 'search.sqlite-shm', 'search.sqlite-wal']);
    assert.equal(db.prepare('SELECT value FROM sample').get()!.value, 'synthetic');
  } finally { db.close(); }
});

test('absent sidecars are optional and unrelated siblings are not searched on rc.3', async t => {
  const f = await fixture(t, '0.2.1-rc.3'); const path = join(f.root, 'search.sqlite');
  await writeFile(path, Buffer.alloc(17)); await writeFile(join(f.root, 'unrelated.bin'), Buffer.alloc(99));
  f.ctx.sessionQuery = { config: { path } };
  const result = await scanStorage((await getStorageSources(f.ctx)).filter(root => root.id === 'search'));
  assert.equal(result.complete, true); assert.equal(result.fileBytes, 17); assert.equal(result.fileCount, 1);
  assert.equal(result.categories[0]!.counters.changed, 0); assert.equal(result.categories[0]!.counters.directories, 0);
  assert.deepEqual(result.categories[0]!.largestFiles.map(file => file.relativePath), ['search.sqlite']);
  assert.equal((await readFile(join(f.root, 'unrelated.bin'))).length, 99);
});

test('WAL, SHM and rollback journal bytes stay in the search category without double counting inside DSH home', async t => {
  const f = await fixture(t); const directory = join(f.home, 'indexes'); await mkdir(directory);
  const path = join(directory, 'search.sqlite');
  for (const [suffix, bytes] of [['', 17], ['-wal', 19], ['-shm', 23], ['-journal', 29]] as const)
    await writeFile(`${path}${suffix}`, Buffer.alloc(bytes));
  await writeFile(join(directory, 'unrelated.bin'), Buffer.alloc(31));
  f.ctx.sessionQuery = { config: { path } };
  const result = await scanStorage(await getStorageSources(f.ctx));
  const search = result.categories.find(item => item.id === 'search')!;
  const other = result.categories.find(item => item.id === 'other')!;
  assert.equal(search.status, 'complete'); assert.equal(search.fileBytes, 88); assert.equal(search.fileCount, 4);
  assert.equal(other.fileBytes, 31); assert.equal(result.fileBytes, 119); assert.equal(result.referencedBytes, 119);
  assert.equal(result.fileCount, 5); assert.equal(result.duplicatePaths, 0);
  assert.deepEqual(search.overlaps, []); assert.deepEqual(other.overlaps, []);
  assert.deepEqual(other.largestFiles.map(file => file.relativePath), ['indexes/unrelated.bin']);
});

test('explicit sidecar roots deduplicate and disclose overlap in either category order', async t => {
  const f = await fixture(t); const path = join(f.root, 'search.sqlite');
  await writeFile(path, Buffer.alloc(17)); await writeFile(`${path}-wal`, Buffer.alloc(19));
  f.ctx.sessionQuery = { config: { path } };
  const search = (await getStorageSources(f.ctx)).find(root => root.id === 'search')!;
  const wal = { id: 'separate-wal', kind: 'other', readOnly: true as const, path: `${path}-wal`, file: true as const };
  for (const roots of [[search, wal], [wal, search]]) {
    const result = await scanStorage(roots);
    assert.equal(result.complete, true); assert.equal(result.fileBytes, 36); assert.equal(result.referencedBytes, 55);
    assert.equal(result.duplicatePaths, 1);
    assert.deepEqual(result.categories.find(item => item.id === 'search')!.overlaps, ['separate-wal']);
    assert.deepEqual(result.categories.find(item => item.id === 'separate-wal')!.overlaps, ['search']);
  }
});

test('remaining sidecars are measured as partial when the database itself is missing', async t => {
  const f = await fixture(t); const path = join(f.root, 'search.sqlite');
  await writeFile(`${path}-wal`, Buffer.alloc(19));
  f.ctx.sessionQuery = { config: { path } };
  const result = await scanStorage((await getStorageSources(f.ctx)).filter(root => root.id === 'search'));
  assert.equal(result.complete, false); assert.equal(result.categories[0]!.status, 'partial');
  assert.equal(result.fileBytes, 19); assert.equal(result.fileCount, 1);
  assert.ok(result.categories[0]!.issues.some(issue => issue.code === 'entry-disappeared' && issue.relativePath === 'search.sqlite'));
  await assert.rejects(lstat(path), { code: 'ENOENT' });
});

test('a sidecar directory is skipped without enumerating its files', async t => {
  const f = await fixture(t); const path = join(f.root, 'search.sqlite');
  await writeFile(path, Buffer.alloc(17)); await mkdir(`${path}-wal`);
  await writeFile(join(`${path}-wal`, 'not-a-database-file'), Buffer.alloc(101));
  f.ctx.sessionQuery = { config: { path } };
  const result = await scanStorage((await getStorageSources(f.ctx)).filter(root => root.id === 'search'));
  assert.equal(result.complete, false); assert.equal(result.fileBytes, 17); assert.equal(result.fileCount, 1);
  assert.equal(result.categories[0]!.counters.directories, 0);
  assert.deepEqual(result.categories[0]!.largestFiles.map(file => file.relativePath), ['search.sqlite']);
});

test('sidecar links are skipped without including their external targets', async t => {
  const f = await fixture(t); const path = join(f.root, 'search.sqlite'); const target = join(f.root, 'outside.bin');
  await writeFile(path, Buffer.alloc(17)); await writeFile(target, Buffer.alloc(101));
  try { await symlink(target, `${path}-wal`, 'file'); }
  catch (error) {
    if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') { t.skip('File symlinks require Windows developer mode.'); return; }
    throw error;
  }
  f.ctx.sessionQuery = { config: { path } };
  const result = await scanStorage((await getStorageSources(f.ctx)).filter(root => root.id === 'search'));
  assert.equal(result.complete, false); assert.equal(result.fileBytes, 17); assert.equal(result.categories[0]!.counters.symlinks, 1);
  assert.deepEqual(result.categories[0]!.largestFiles.map(file => file.relativePath), ['search.sqlite']);
  assert.equal((await readFile(target)).length, 101);
});

test('an entirely absent database and sidecar group remains missing', async t => {
  const f = await fixture(t); const path = join(f.root, 'search.sqlite');
  f.ctx.sessionQuery = { config: { path } };
  const result = await scanStorage((await getStorageSources(f.ctx)).filter(root => root.id === 'search'));
  assert.equal(result.complete, false); assert.equal(result.categories[0]!.status, 'missing');
  assert.equal(result.categories[0]!.fileBytes, null); assert.equal(result.fileCount, 0);
});

test('an orphan sidecar directory does not hide another valid sidecar', async t => {
  const f = await fixture(t); const path = join(f.root, 'search.sqlite'); await mkdir(`${path}-wal`);
  await writeFile(join(`${path}-wal`, 'unrelated.bin'), Buffer.alloc(101)); await writeFile(`${path}-shm`, Buffer.alloc(23));
  f.ctx.sessionQuery = { config: { path } };
  const result = await scanStorage((await getStorageSources(f.ctx)).filter(root => root.id === 'search'));
  const category = result.categories[0]!;
  assert.equal(category.status, 'partial'); assert.equal(result.fileBytes, 23); assert.equal(result.fileCount, 1);
  assert.ok(category.issues.some(issue => issue.code === 'special-file-skipped' && issue.relativePath === 'search.sqlite-wal'));
  assert.equal(category.counters.directories, 0);
  assert.deepEqual(category.largestFiles.map(file => file.relativePath), ['search.sqlite-shm']);
});

test('an orphan sidecar link is skipped while a later regular sidecar is counted', async t => {
  const f = await fixture(t); const path = join(f.root, 'search.sqlite'); const target = join(f.root, 'external.bin');
  await writeFile(target, Buffer.alloc(101)); await writeFile(`${path}-shm`, Buffer.alloc(23));
  try { await symlink(target, `${path}-wal`, 'file'); }
  catch (error) {
    if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') { t.skip('File symlinks require Windows developer mode.'); return; }
    throw error;
  }
  f.ctx.sessionQuery = { config: { path } };
  const result = await scanStorage((await getStorageSources(f.ctx)).filter(root => root.id === 'search'));
  assert.equal(result.categories[0]!.status, 'partial'); assert.equal(result.fileBytes, 23);
  assert.ok(result.categories[0]!.issues.some(issue => issue.code === 'link-skipped' && issue.relativePath === 'search.sqlite-wal'));
  assert.equal(result.categories[0]!.counters.symlinks, 1); assert.equal((await readFile(target)).length, 101);
});

test('an orphan group with only an invalid sidecar remains unavailable with its skip reason', async t => {
  const f = await fixture(t); const path = join(f.root, 'search.sqlite'); await mkdir(`${path}-wal`);
  f.ctx.sessionQuery = { config: { path } };
  const result = await scanStorage((await getStorageSources(f.ctx)).filter(root => root.id === 'search'));
  const category = result.categories[0]!;
  assert.equal(category.status, 'unavailable'); assert.equal(category.fileBytes, null);
  assert.ok(category.issues.some(issue => issue.code === 'special-file-skipped' && issue.relativePath === 'search.sqlite-wal'));
});
