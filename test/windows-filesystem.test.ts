import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertCanonicalStoragePath, assertLocalStoragePath, assertPlainDirectory, assertPrivateDirectory, isWithin, readBoundedJson, samePath } from '../src/filesystem.js';
import { TrashStore } from '../src/storage.js';
import { acquirePluginLease } from '../src/dsh-adapter.js';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-windows-filesystem-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('Windows lexical storage admission excludes network, device and ambiguous aliases', () => {
  for (const path of [String.raw`C:\Users\Example\AppData\Local\DSH`, String.raw`d:\测试 空间\archive-delete`, 'C:/Users/Example/archive-delete'])
    assert.doesNotThrow(() => assertLocalStoragePath(path, 'win32'), path);
  for (const path of [
    String.raw`\\server\share\sessions`, String.raw`\\?\C:\sessions`, String.raw`\\.\C:\sessions`,
    String.raw`C:sessions`, String.raw`\sessions`, 'relative/sessions',
    String.raw`C:\sessions\CON`, String.raw`C:\sessions\NUL.json`, String.raw`C:\sessions\cOm1.log`,
    String.raw`C:\sessions\LPT9`, String.raw`C:\sessions\trailing.`, String.raw`C:\sessions\trailing `,
    String.raw`C:\sessions\file:stream`, String.raw`C:\sessions\..\neighbor`, String.raw`C:\sessions\.\neighbor`,
    'C:\\sessions\\control\0name',
  ]) assert.throws(() => assertLocalStoragePath(path, 'win32'), { code: 'unsafe-path' }, path);
});

test('Windows canonical admission seam compares Windows paths on every test platform', async () => {
  await assertCanonicalStoragePath(String.raw`C:\DSH\Sessions`, String.raw`c:\dsh\sessions`, 'win32');
  await assertCanonicalStoragePath('C:/DSH/Sessions', String.raw`C:\DSH\Sessions`, 'win32');
  for (const canonical of [String.raw`C:\other\sessions`, String.raw`D:\DSH\Sessions`, String.raw`\\server\share\Sessions`])
    await assert.rejects(assertCanonicalStoragePath(String.raw`C:\DSH\Sessions`, canonical, 'win32'), { code: 'unsafe-path' });
});

test('bounded recovery JSON admits regular data and refuses corrupt or oversized data', async t => {
  const root = await fixture(t); const path = join(root, 'record.json');
  await writeFile(path, '{"schema":1}'); assert.deepEqual(await readBoundedJson(path), { schema: 1 });
  await writeFile(path, '{broken'); await assert.rejects(readBoundedJson(path), { code: 'corrupt-state' });
  await writeFile(path, JSON.stringify({ text: 'x'.repeat(64) }));
  await assert.rejects(readBoundedJson(path, 32), { code: 'corrupt-state' });
});

test('Windows native junctions and file symlinks cannot authorize recovery access', { skip: process.platform !== 'win32' }, async t => {
  const root = await fixture(t); const target = join(root, 'target'); await mkdir(target);
  const original = join(target, 'record.json'); const bytes = '{"synthetic":true}'; await writeFile(original, bytes);
  const junction = join(root, 'redirect'); await symlink(target, junction, 'junction');
  await assert.rejects(assertPlainDirectory(junction), { code: 'unsafe-path' });
  await assert.rejects(assertPrivateDirectory(junction), { code: 'unsafe-path' });
  const linked = join(root, 'linked.json'); await symlink(original, linked, 'file');
  await assert.rejects(readBoundedJson(linked), { code: 'corrupt-state' });
  assert.equal(await readFile(original, 'utf8'), bytes);
});

test('Windows native case aliases retain identity without making sibling prefixes descendants', { skip: process.platform !== 'win32' }, async t => {
  const root = await fixture(t); const path = join(root, 'MixedCase'); await mkdir(path);
  assert.equal(samePath(path, path.toUpperCase()), true);
  assert.equal(isWithin(root.toUpperCase(), path), true);
  assert.equal(isWithin(path, `${path}-neighbor`), false);
  assert.equal(isWithin(root, root.toLowerCase()), false);
  await assertCanonicalStoragePath(path.toUpperCase());
});

test('Windows ancestor junction aliases cannot split storage or kernel-lock ownership', { skip: process.platform !== 'win32' }, async t => {
  const root = await fixture(t); const physical = join(root, 'physical'); await mkdir(physical);
  const sessions = join(physical, 'sessions'); await mkdir(sessions);
  const alias = join(root, 'alias'); await symlink(physical, alias, 'junction');
  const aliasedSessions = join(alias, 'sessions');
  await assertPlainDirectory(aliasedSessions);
  await assert.rejects(assertCanonicalStoragePath(aliasedSessions), { code: 'unsafe-path' });
  const store = new TrashStore({ root: join(alias, 'archive-delete'), sessionsRoot: aliasedSessions });
  await assert.rejects(store.initialize(), { code: 'unsafe-path' });
  let attemptedLock = false;
  await assert.rejects(acquirePluginLease(join(alias, 'archive-delete'), async () => {}, { lockNamed: async () => {
    attemptedLock = true; return { release: async () => {} };
  } }), { code: 'unsafe-path' });
  assert.equal(attemptedLock, false);
});
