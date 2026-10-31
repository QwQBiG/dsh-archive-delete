import assert from 'node:assert/strict';
import { chmod, link, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { scanStorage, type UsageRoot } from '../src/storage-usage.js';

async function fixture(t: TestContext) {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'storage-usage-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  return home;
}
const root = (id: string, path?: string): UsageRoot => ({ id, kind: 'workspace', readOnly: true, ...(path ? { path } : {}) });

test('read-only inventory reports current logical bytes, first-level folders and relative top files', async t => {
  const home = await fixture(t); await mkdir(join(home, 'nested'));
  await writeFile(join(home, 'nested', 'large.bin'), Buffer.alloc(11));
  await writeFile(join(home, 'small.tmp'), Buffer.alloc(3));
  const listing = await readdir(home); const original = await readFile(join(home, 'small.tmp'));
  const result = await scanStorage([root('workspace', home)]);
  assert.equal(result.metric, 'logical-file-bytes'); assert.equal(result.complete, true);
  assert.equal(result.fileBytes, 14); assert.equal(result.referencedBytes, 14); assert.equal(result.fileCount, 2);
  const category = result.categories[0]!;
  assert.equal(category.status, 'complete'); assert.equal(category.uniqueFileCount, 2);
  assert.deepEqual(category.directories, [{ relativePath: 'nested', fileBytes: 11, fileCount: 1 }, { relativePath: '.', fileBytes: 3, fileCount: 1 }]);
  assert.deepEqual(category.largestFiles, [{ relativePath: 'nested/large.bin', sizeBytes: 11, source: 'unknown', kind: 'other' }, { relativePath: 'small.tmp', sizeBytes: 3, source: 'unknown', kind: 'other' }]);
  assert.ok(result.finishedAt >= result.startedAt); assert.ok(result.durationMs >= 0);
  assert.deepEqual(await readdir(home), listing); assert.deepEqual(await readFile(join(home, 'small.tmp')), original);
  await writeFile(join(home, 'small.tmp'), Buffer.alloc(7));
  assert.equal((await scanStorage([root('workspace', home)])).fileBytes, 18);
});

test('hard links and overlapping roots are globally deduplicated without hiding per-category referenced bytes', async t => {
  const home = await fixture(t); const one = join(home, 'one'); const two = join(home, 'two');
  await mkdir(one); await mkdir(two); await writeFile(join(one, 'object'), Buffer.alloc(13)); await link(join(one, 'object'), join(two, 'alias'));
  const result = await scanStorage([root('one', one), root('two', two)]);
  assert.equal(result.complete, true); assert.equal(result.fileBytes, 13); assert.equal(result.referencedBytes, 26);
  assert.equal(result.uniqueFileCount, 1); assert.equal(result.duplicateHardlinks, 1);
  assert.deepEqual(result.categories.map(category => category.fileBytes), [13, 13]);
  const overlaps = await scanStorage([root('all', home), root('nested', one)]);
  assert.equal(overlaps.fileBytes, 13); assert.equal(overlaps.referencedBytes, 39); assert.equal(overlaps.duplicatePaths, 1);
  assert.deepEqual(overlaps.categories[0]!.overlaps, ['nested']); assert.deepEqual(overlaps.categories[1]!.overlaps, ['all']);
});

test('links and junctions never bring their target into the inventory or modify it', async t => {
  const home = await fixture(t); const selected = join(home, 'selected'); const outside = join(home, 'outside');
  await mkdir(selected); await mkdir(outside); const target = join(outside, 'keep.bin'); await writeFile(target, Buffer.alloc(99));
  await writeFile(join(selected, 'own.bin'), Buffer.alloc(4));
  await symlink(outside, join(selected, 'redirect'), process.platform === 'win32' ? 'junction' : 'dir');
  let fileLink = false;
  try { await symlink(target, join(selected, 'linked.bin'), 'file'); fileLink = true; }
  catch (error) { if (process.platform !== 'win32' || (error as NodeJS.ErrnoException).code !== 'EPERM') throw error; }
  const result = await scanStorage([root('selected', selected)]);
  assert.equal(result.complete, false); assert.equal(result.categories[0]!.status, 'partial');
  assert.equal(result.fileBytes, 4); assert.equal(result.categories[0]!.counters.symlinks, fileLink ? 2 : 1);
  assert.deepEqual(result.categories[0]!.largestFiles.map(file => file.relativePath), ['own.bin']);
  assert.equal((await readFile(target)).length, 99); assert.deepEqual(await readdir(outside), ['keep.bin']);
  const alias = await scanStorage([root('alias', join(selected, 'redirect'))]);
  assert.equal(alias.categories[0]!.status, 'unavailable'); assert.equal(alias.categories[0]!.fileBytes, null);
});

test('an ancestor redirection is rejected instead of being included under the chosen root', async t => {
  const home = await fixture(t); const selected = join(home, 'selected'); await mkdir(selected);
  const original = join(selected, 'nested'); await mkdir(original); await writeFile(join(original, 'own'), Buffer.alloc(4));
  const target = join(home, 'external'); await mkdir(target); await writeFile(join(target, 'other'), Buffer.alloc(99));
  let changed = false;
  const result = await scanStorage([root('selected', selected)], { yieldEvery: 1, onProgress: progress => {
    // The callback runs before another filesystem observation; replacement is
    // synchronous to model a concurrent directory swap deterministically.
    if (changed || progress.files === 0) return;
    changed = true; renameSync(original, join(selected, 'before-swap'));
    symlinkSync(target, original, process.platform === 'win32' ? 'junction' : 'dir');
  } });
  assert.equal(changed, true); assert.equal(result.complete, false);
  assert.equal(result.fileBytes, 4);
  assert.ok(result.categories[0]!.counters.changed > 0);
  assert.equal((await readFile(join(target, 'other'))).length, 99);
});

test('a file written after measurement marks the observed byte total as partial', async t => {
  const home = await fixture(t); const file = join(home, 'file'); await writeFile(file, Buffer.alloc(4));
  let changed = false;
  const result = await scanStorage([root('data', home)], { yieldEvery: 1, onProgress: progress => {
    if (!changed && progress.files > 0) { changed = true; writeFileSync(file, Buffer.alloc(7)); }
  } });
  assert.equal(changed, true); assert.equal(result.fileBytes, 4); assert.equal(result.complete, false);
  assert.ok(result.categories[0]!.issues.some(issue => issue.code === 'entry-changed'));
  assert.equal((await readFile(file)).length, 7);
});

test('entry, time, depth and cancellation limits report partial results rather than complete zero totals', async t => {
  const home = await fixture(t); await mkdir(join(home, 'nested')); await writeFile(join(home, 'root'), Buffer.alloc(5));
  await writeFile(join(home, 'nested', 'inside'), Buffer.alloc(8));
  const budget = await scanStorage([root('data', home)], { maxEntries: 1 });
  assert.equal(budget.complete, false); assert.ok(budget.categories[0]!.issues.some(issue => issue.code === 'entry-budget'));
  const timed = await scanStorage([root('data', home)], { maxDurationMs: 0 });
  assert.equal(timed.categories[0]!.status, 'partial'); assert.equal(timed.categories[0]!.fileBytes, null);
  assert.ok(timed.categories[0]!.issues.some(issue => issue.code === 'time-budget'));
  const depth = await scanStorage([root('data', home)], { maxDepth: 0 });
  assert.equal(depth.fileBytes, 5); assert.equal(depth.complete, false); assert.equal(depth.categories[0]!.counters.depthLimit, 1);
  const controller = new AbortController(); controller.abort();
  const cancelled = await scanStorage([root('data', home)], { signal: controller.signal });
  assert.equal(cancelled.complete, false); assert.ok(cancelled.categories[0]!.issues.some(issue => issue.code === 'cancelled'));
});

test('cancellation during progress preserves measured bytes and does not write files', async t => {
  const home = await fixture(t); for (const name of ['one', 'two', 'three']) await writeFile(join(home, name), Buffer.alloc(4));
  const before = await readdir(home); const controller = new AbortController();
  const result = await scanStorage([root('data', home)], { yieldEvery: 1, signal: controller.signal,
    onProgress: progress => { if (progress.files > 0) controller.abort(); } });
  assert.equal(result.complete, false); assert.equal(result.fileBytes, 4);
  assert.ok(result.categories[0]!.issues.some(issue => issue.code === 'cancelled'));
  assert.deepEqual(await readdir(home), before);
});

test('unresolved, missing and invalid roots remain unknown without creating directories', async t => {
  const home = await fixture(t); const missing = join(home, 'missing');
  const result = await scanStorage([{ ...root('unresolved'), unavailableReason: 'provider-unavailable' }, root('missing', missing), root('relative', 'relative/path')]);
  assert.equal(result.complete, false);
  assert.deepEqual(result.categories.map(category => category.status), ['unavailable', 'missing', 'unavailable']);
  assert.deepEqual(result.categories.map(category => category.fileBytes), [null, null, null]);
  assert.equal(result.categories[0]!.issues[0]!.code, 'provider-unavailable'); assert.deepEqual(await readdir(home), []);
});

test('an unreadable directory is explicitly partial', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async t => {
  const home = await fixture(t); const unreadable = join(home, 'private'); await mkdir(unreadable); await writeFile(join(unreadable, 'keep'), 'retained');
  await chmod(unreadable, 0);
  try {
    const result = await scanStorage([root('data', home)]);
    assert.equal(result.complete, false); assert.equal(result.categories[0]!.status, 'partial');
    assert.ok(result.categories[0]!.counters.unreadable > 0);
  } finally { await chmod(unreadable, 0o700); }
  assert.equal(await readFile(join(unreadable, 'keep'), 'utf8'), 'retained');
});

test('top lists are bounded and never infer AI origin from names or timestamps', async t => {
  const home = await fixture(t); for (const [name, bytes] of [['final.pdf', 3], ['garbage.tmp', 7], ['old-cache.bin', 9]] as const) await writeFile(join(home, name), Buffer.alloc(bytes));
  const result = await scanStorage([root('workspace', home)], { largestLimit: 2, directoryLimit: 1 });
  assert.equal(result.categories[0]!.largestFiles.length, 2); assert.equal(result.categories[0]!.directories.length, 1);
  assert.ok(result.categories[0]!.largestFiles.every(file => file.source === 'unknown'));
  assert.deepEqual(result.categories[0]!.largestFiles.map(file => file.relativePath), ['old-cache.bin', 'garbage.tmp']);
  await assert.rejects(scanStorage([root('same', home), root('same', home)]), TypeError);
  await assert.rejects(scanStorage([root('a', home)], { maxDepth: -1 }), RangeError);
});

test('separately categorized descendant paths are excluded without incomplete totals or false overlaps', async t => {
  const home = await fixture(t); const cache = join(home, 'cache'); const attachments = join(cache, 'attachments');
  await mkdir(attachments, { recursive: true }); await writeFile(join(attachments, 'object'), Buffer.alloc(13));
  await writeFile(join(cache, 'other'), Buffer.alloc(7));
  const result = await scanStorage([{ ...root('other-cache', cache), excludePaths: [attachments, join(cache, 'not-created')] }, root('attachments', attachments)]);
  assert.equal(result.complete, true); assert.equal(result.fileBytes, 20); assert.equal(result.referencedBytes, 20);
  assert.deepEqual(result.categories.map(category => category.fileBytes), [7, 13]);
  assert.equal(result.categories[0]!.counters.excluded, 1); assert.equal(result.categories[0]!.counters.unreadable, 0);
  assert.deepEqual(result.categories.map(category => category.overlaps), [[], []]);
  assert.deepEqual(result.categories[0]!.largestFiles.map(file => file.relativePath), ['other']);
  const reversed = await scanStorage([root('attachments', attachments), { ...root('other-cache', cache), excludePaths: [attachments] }]);
  assert.deepEqual(reversed.categories.map(category => category.overlaps), [[], []]);
  assert.equal((await readFile(join(attachments, 'object'))).length, 13);
});

test('exclusions cannot hide the whole root or point outside the configured root', async t => {
  const home = await fixture(t); const selected = join(home, 'selected'); await mkdir(selected);
  await writeFile(join(selected, 'keep'), 'retained');
  for (const excluded of [selected, home, join(home, 'other'), 'relative']) {
    const result = await scanStorage([{ ...root('selected', selected), excludePaths: [excluded] }]);
    assert.equal(result.categories[0]!.status, 'unavailable'); assert.equal(result.categories[0]!.fileBytes, null);
    assert.equal(result.complete, false);
  }
  assert.equal(await readFile(join(selected, 'keep'), 'utf8'), 'retained');
});

test('exclusions match both configured and canonical paths without following an excluded link', { skip: process.platform === 'win32' }, async t => {
  const home = await fixture(t); const actual = join(home, 'actual'); const selected = join(actual, 'selected');
  await mkdir(join(selected, 'separate'), { recursive: true }); await writeFile(join(selected, 'separate', 'object'), Buffer.alloc(11));
  await writeFile(join(selected, 'own'), Buffer.alloc(5));
  const alias = join(home, 'alias'); await symlink(actual, alias, 'dir');
  const configured = join(alias, 'selected');
  for (const excludePath of [join(configured, 'separate'), join(selected, 'separate')]) {
    const result = await scanStorage([{ ...root('selected', configured), excludePaths: [excludePath] }]);
    assert.equal(result.complete, true); assert.equal(result.fileBytes, 5); assert.equal(result.categories[0]!.counters.excluded, 1);
  }
  const outside = join(home, 'outside'); await mkdir(outside); await writeFile(join(outside, 'keep'), 'retained');
  const redirect = join(selected, 'redirect'); await symlink(outside, redirect, 'dir');
  const result = await scanStorage([{ ...root('selected', configured), excludePaths: [redirect, join(selected, 'separate')] }]);
  assert.equal(result.complete, true); assert.equal(result.fileBytes, 5); assert.equal(result.categories[0]!.counters.excluded, 2);
  assert.equal(await readFile(join(outside, 'keep'), 'utf8'), 'retained');
});

test('only declared regular-file roots are measured and deduplicated, without scanning their parent', async t => {
  const home = await fixture(t); const database = join(home, 'search.sqlite'); const alias = join(home, 'alias.sqlite');
  await writeFile(database, Buffer.alloc(17)); await link(database, alias); await writeFile(join(home, 'unrelated'), Buffer.alloc(99));
  const result = await scanStorage([{ ...root('database', database), file: true }, { ...root('alias', alias), file: true }]);
  assert.equal(result.complete, true); assert.equal(result.fileBytes, 17); assert.equal(result.referencedBytes, 34);
  assert.equal(result.fileCount, 2); assert.equal(result.duplicateHardlinks, 1);
  assert.deepEqual(result.categories[0]!.largestFiles, [{ relativePath: 'search.sqlite', sizeBytes: 17, source: 'unknown', kind: 'other' }]);
  assert.equal(result.categories[0]!.counters.directories, 0);
  const invalid = await scanStorage([root('default-file', database), { ...root('declared-directory', home), file: true },
    { ...root('file-exclusion', database), file: true, excludePaths: [join(database, 'child')] }]);
  assert.deepEqual(invalid.categories.map(category => category.status), ['unavailable', 'unavailable', 'unavailable']);
  const linkPath = join(home, 'link.sqlite');
  try { await symlink(database, linkPath, 'file'); }
  catch (error) { if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') return; throw error; }
  const redirected = await scanStorage([{ ...root('link', linkPath), file: true }]);
  assert.equal(redirected.categories[0]!.status, 'unavailable'); assert.equal(redirected.categories[0]!.fileBytes, null);
  assert.equal((await readFile(database)).length, 17);
});
