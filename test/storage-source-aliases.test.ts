import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { getStorageSources, type HostContext } from '../src/dsh-adapter.js';
import { scanStorage } from '../src/storage-usage.js';

async function fixture(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'storage-source-aliases-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const physical = join(root, 'physical'); const home = join(physical, 'host'); await mkdir(home, { recursive: true });
  const alias = join(root, 'alias'); await symlink(physical, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const anchor = join(root, 'host-package.json'); await writeFile(anchor, JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.1-rc.5' }));
  const records = new Map<string, { record: { path: string; title: string } }>();
  const ctx: HostContext = { profileContext: { installAnchor: anchor }, dshHomePath: () => home,
    workspaceRegistry: { requireState: () => ({ workspaceIds: [...records.keys()] }), entities: records } };
  return { root, physical, home, alias, ctx, records };
}

const posixOnly = { skip: process.platform === 'win32' };

test('DSH host scans exclude registered canonical projects below an aliased DSH home', posixOnly, async t => {
  const f = await fixture(t); const project = join(f.home, 'workspaces', 'registered'); await mkdir(project, { recursive: true });
  await writeFile(join(project, 'project-only.bin'), Buffer.alloc(123));
  f.records.set('project', { record: { path: project, title: 'Project' } }); f.ctx.dshHomePath = () => join(f.alias, 'host');
  const result = await scanStorage(await getStorageSources(f.ctx));
  const other = result.categories.find(category => category.id === 'other')!;
  assert.equal(other.status, 'complete'); assert.equal(result.fileBytes, 0); assert.equal(other.counters.excluded, 1);
  assert.deepEqual(other.largestFiles, []);
  assert.equal((await readFile(join(project, 'project-only.bin'))).length, 123);
});

test('canonical project exclusions also recognize a registered ancestor alias', posixOnly, async t => {
  const f = await fixture(t); const project = join(f.home, 'workspaces', 'registered'); await mkdir(project, { recursive: true });
  await writeFile(join(project, 'project-only.bin'), Buffer.alloc(123));
  f.records.set('project', { record: { path: join(f.alias, 'host', 'workspaces', 'registered'), title: 'Project' } });
  const result = await scanStorage(await getStorageSources(f.ctx));
  assert.equal(result.fileBytes, 0); assert.deepEqual(result.categories.find(category => category.id === 'other')!.largestFiles, []);
  await assert.rejects(getStorageSources(f.ctx, 'project'), { code: 'unsafe-workspace' });
});

test('custom nested storage owners use physical containment without duplicate parent-category bytes', posixOnly, async t => {
  const f = await fixture(t); const attachments = join(f.home, 'cache', 'attachments'); await mkdir(attachments, { recursive: true });
  await writeFile(join(attachments, 'object.bin'), Buffer.alloc(13)); await writeFile(join(f.home, 'cache', 'cache.bin'), Buffer.alloc(7));
  f.ctx.attachments = { root: join(f.alias, 'host', 'cache', 'attachments') };
  const result = await scanStorage(await getStorageSources(f.ctx));
  assert.equal(result.fileBytes, 20); assert.equal(result.referencedBytes, 20); assert.equal(result.duplicatePaths, 0);
  assert.equal(result.categories.find(category => category.id === 'attachments')!.fileBytes, 13);
  assert.equal(result.categories.find(category => category.id === 'cache')!.fileBytes, 7);
  assert.equal(result.categories.find(category => category.id === 'other')!.fileBytes, 0);
  assert.ok(result.categories.every(category => category.overlaps.length === 0));
});

test('outside-home owners are not excluded from unrelated host paths', posixOnly, async t => {
  const f = await fixture(t); const external = join(f.physical, 'external-attachments'); await mkdir(external);
  await writeFile(join(external, 'external.bin'), Buffer.alloc(13)); await writeFile(join(f.home, 'own.bin'), Buffer.alloc(7));
  f.ctx.attachments = { root: join(f.alias, 'external-attachments') };
  const result = await scanStorage(await getStorageSources(f.ctx));
  assert.equal(result.fileBytes, 20); assert.equal(result.referencedBytes, 20);
  assert.equal(result.categories.find(category => category.id === 'attachments')!.fileBytes, 13);
  assert.equal(result.categories.find(category => category.id === 'other')!.fileBytes, 7);
});

test('equivalent registered paths are deduplicated as one physical exclusion', posixOnly, async t => {
  const f = await fixture(t); const project = join(f.home, 'workspaces', 'registered'); await mkdir(project, { recursive: true });
  await writeFile(join(project, 'project-only.bin'), Buffer.alloc(123));
  f.records.set('physical', { record: { path: project, title: 'Physical spelling' } });
  f.records.set('alias', { record: { path: join(f.alias, 'host', 'workspaces', 'registered'), title: 'Alias spelling' } });
  const roots = await getStorageSources(f.ctx); const other = roots.find(root => root.id === 'other')!;
  assert.equal(other.excludePaths!.filter(path => path.endsWith('registered')).length, 1);
  assert.equal((await scanStorage(roots)).fileBytes, 0);
  assert.deepEqual(f.records.get('alias')!.record, { path: join(f.alias, 'host', 'workspaces', 'registered'), title: 'Alias spelling' });
});

test('configured parent and child owners outside DSH home remain separate through an ancestor alias', posixOnly, async t => {
  const f = await fixture(t); const external = join(f.physical, 'external'); const sessions = join(external, 'sessions');
  await mkdir(sessions, { recursive: true }); await writeFile(join(external, 'attachment.bin'), Buffer.alloc(13));
  await writeFile(join(sessions, 'session.jsonl'), Buffer.alloc(17));
  f.ctx.attachments = { root: join(f.alias, 'external'), open: () => assert.fail('a storage provider was opened') };
  f.ctx.sessionPersistence = { root: sessions };
  const roots = await getStorageSources(f.ctx); const result = await scanStorage(roots);
  assert.equal(result.fileBytes, 30); assert.equal(result.referencedBytes, 30); assert.equal(result.duplicatePaths, 0);
  assert.equal(result.categories.find(category => category.id === 'attachments')!.fileBytes, 13);
  assert.equal(result.categories.find(category => category.id === 'sessions')!.fileBytes, 17);
  assert.ok(result.categories.every(category => category.overlaps.length === 0));
  assert.equal(roots.find(item => item.id === 'attachments')!.path, join(f.alias, 'external'));
});

test('resolving exclusions does not turn a linked root into a permitted directory', posixOnly, async t => {
  const f = await fixture(t); await writeFile(join(f.home, 'own.bin'), Buffer.alloc(7));
  const linkedHome = join(f.root, 'home-link'); await symlink(f.home, linkedHome, 'dir'); f.ctx.dshHomePath = () => linkedHome;
  const roots = await getStorageSources(f.ctx); assert.equal(roots.find(item => item.id === 'other')!.path, linkedHome);
  const result = await scanStorage(roots);
  assert.equal(result.categories.find(category => category.id === 'other')!.status, 'unavailable');
  assert.equal(result.categories.find(category => category.id === 'other')!.fileBytes, null);
  assert.equal((await readFile(join(f.home, 'own.bin'))).length, 7);
});

test('a workspace registered inside an aliased protected session store remains in host storage', posixOnly, async t => {
  const f = await fixture(t); const sessions = join(f.home, 'sessions'); const internal = join(sessions, 'registered');
  await mkdir(internal, { recursive: true }); await writeFile(join(internal, 'session.jsonl'), Buffer.alloc(17));
  f.ctx.sessionPersistence = { root: join(f.alias, 'host', 'sessions') };
  f.records.set('internal', { record: { path: internal, title: 'Internal registration' } });
  const result = await scanStorage(await getStorageSources(f.ctx));
  assert.equal(result.fileBytes, 17); assert.equal(result.referencedBytes, 17);
  assert.equal(result.categories.find(category => category.id === 'sessions')!.fileBytes, 17);
  assert.equal(result.categories.find(category => category.id === 'other')!.fileBytes, 0);
  await assert.rejects(getStorageSources(f.ctx, 'internal'), { code: 'unsafe-workspace' });
  assert.equal((await readFile(join(internal, 'session.jsonl'))).length, 17);
});
