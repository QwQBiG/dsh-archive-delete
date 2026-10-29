import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArchiveError, type ArchiveApi } from '../src/contracts.js';
import { ArchiveClientController, ClientTransportError } from '../src/client-state.js';
import { createArchiveApi } from '../src/client.js';
import { UpdateClientController } from '../src/update-client.js';
import { UpdateCard } from '../src/update-ui.js';
import { translator, type NativePrimitives } from '../src/client-ui.js';
import type { UpdateOverview } from '../src/update-contracts.js';

const candidate = { id: 'confirmed-release', version: '0.1.6', requiredDshVersion: '0.2.1-rc.3', publishedAt: '2026-10-29T00:00:00Z',
  releaseUrl: 'https://github.com/QwQBiG/dsh-archive-delete/releases/tag/v0.1.6', notes: '<script>bad()</script>\nA useful change', assetBytes: 1000 };
const available: UpdateOverview = { currentVersion: '0.1.5', installedVersion: '0.1.5', hostVersion: '0.2.1-rc.3', availability: 'available', candidate, canInstall: true, checkedAt: 100 };
const Button: NativePrimitives['Button'] = ({ children, variant: _variant, size: _size, icon, ...props }) => <button {...props}>{icon}{children}</button>;
function fixture(overrides: Partial<ArchiveApi> = {}) {
  const api: ArchiveApi = { list: async () => ({ support: { supported: true, version: '0.2.1-rc.3', platform: 'darwin' }, archived: [], trash: [], recentResults: [] }),
    preview: async () => { throw new Error('unexpected preview'); }, execute: async () => { throw new Error('unexpected mutation'); },
    cancelPending: async () => { throw new Error('unexpected cancellation'); }, updates: async () => available,
    installUpdate: async (_candidateId, requestId) => ({ ...available, installedVersion: '0.1.6', installation: { requestId, version: '0.1.6', status: 'restart-required' } }), ...overrides };
  const archive = new ArchiveClientController(api);
  const updates = new UpdateClientController(api, archive);
  return { api, archive, updates };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

test('checks and review/cancel never install; only a fresh confirmation installs once', async () => {
  let installs = 0; const pending = deferred<UpdateOverview>();
  const f = fixture({ installUpdate: async () => { installs++; return pending.promise; } });
  await f.updates.check(); assert.equal(installs, 0);
  f.updates.review(); assert.equal(f.updates.getSnapshot().reviewId, candidate.id);
  f.updates.cancelReview(); await f.updates.confirm(); assert.equal(installs, 0);
  f.updates.review(); const installing = f.updates.confirm(); await f.updates.confirm();
  assert.equal(installs, 1); assert.equal(f.archive.getSnapshot().maintenance, true);
  f.archive.close(); // Closing the archive window does not cancel an admitted update.
  pending.resolve({ ...available, installedVersion: '0.1.6', installation: { requestId: 'external', version: '0.1.6', status: 'restart-required' } });
  await installing;
  assert.equal(f.updates.getSnapshot().uncertain, true, 'a different receipt cannot settle this confirmation');
  f.updates.dispose(); f.archive.dispose();
});

test('lost reply keeps the same request ID and archive protection through status checks and retry', async () => {
  const ids: string[] = []; let attempt = 0;
  const f = fixture({ installUpdate: async (_id, requestId) => {
    ids.push(requestId);
    if (++attempt === 1) throw new ClientTransportError('lost response');
    return { ...available, installedVersion: '0.1.6', installation: { requestId, version: '0.1.6', status: 'restart-required' } };
  } });
  await f.updates.check(); f.updates.review(); await f.updates.confirm();
  assert.equal(f.updates.getSnapshot().uncertain, true);
  await f.updates.check(); assert.equal(f.archive.getSnapshot().maintenance, true, 'absence of a receipt is not proof of failure');
  await f.updates.retry(); assert.equal(ids.length, 2); assert.equal(ids[0], ids[1]);
  assert.equal(f.updates.getSnapshot().uncertain, false); assert.equal(f.archive.getSnapshot().maintenance, true);
  f.updates.dispose(); f.archive.dispose();
});

test('native failure with the running version retained releases archive protection; a changed release clears consent', async () => {
  let data = available;
  const f = fixture({ updates: async () => data,
    installUpdate: async (_id, requestId) => ({ ...available, installation: { requestId, version: '0.1.6', status: 'failed', code: 'update-install-failed' } }) });
  await f.updates.check(); f.updates.review(); await f.updates.confirm();
  assert.equal(f.archive.getSnapshot().maintenance, false);
  f.updates.review(); data = { ...available, candidate: { ...candidate, id: 'new-release-pin' } };
  await f.updates.check(true); assert.equal(f.updates.getSnapshot().reviewId, null);
  f.updates.dispose(); f.archive.dispose();
});

test('disposal ignores a late check reply', async () => {
  const initial = deferred<UpdateOverview>(); const f = fixture({ updates: async () => initial.promise });
  const checking = f.updates.check(); f.updates.dispose(); initial.resolve(available); await checking;
  assert.equal(f.updates.getSnapshot().data, null); f.archive.dispose();
});

test('archive maintenance blocks update review and archive mutations', async () => {
  let mutations = 0; const f = fixture({ cancelPending: async () => { mutations++; throw new Error('must not run'); } });
  await f.updates.check(); f.archive.setMaintenance(true); f.updates.review();
  assert.equal(f.updates.getSnapshot().reviewId, null);
  await f.archive.cancelPending(['pending']); await f.archive.confirm(); assert.equal(mutations, 0);
  f.updates.dispose(); f.archive.dispose();
});

test('native update refusals retain actionable error state without starting a second operation', async () => {
  const f = fixture({ installUpdate: async () => { throw new ArchiveError('update-changed', 'Review again'); } });
  await f.updates.check(); f.updates.review(); await f.updates.confirm();
  assert.equal(f.updates.getSnapshot().error, 'update-changed'); assert.equal(f.updates.getSnapshot().uncertain, false);
  assert.equal(f.archive.getSnapshot().maintenance, false); f.updates.dispose(); f.archive.dispose();
});

test('an unavailable plugin route is distinguished from GitHub failure and cannot reuse stale review', async () => {
  let broken = false;
  const f = fixture({ updates: async () => { if (broken) throw new ClientTransportError('local service route unavailable'); return available; } });
  await f.updates.check(); f.updates.review(); broken = true; await f.updates.check(true);
  assert.equal(f.updates.getSnapshot().error, 'update-service-unavailable');
  f.updates.cancelReview(); f.updates.review(); assert.equal(f.updates.getSnapshot().reviewId, null);
  broken = false; await f.updates.check(true); f.updates.review(); assert.equal(f.updates.getSnapshot().reviewId, candidate.id);
  f.updates.dispose(); f.archive.dispose();
});

test('update transport submits IDs only and refuses untrusted release URLs or malformed status', async () => {
  const bodies: unknown[] = [];
  const transport: typeof fetch = async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ ok: true, value: available })); };
  const api = createArchiveApi(transport, 'http://127.0.0.1/prefix/');
  await api.updates!(false); const id = randomUUID(); await api.installUpdate!(candidate.id, id);
  assert.deepEqual(bodies, [{ action: 'updates', force: false }, { action: 'installUpdate', candidateId: candidate.id, requestId: id }]);
  for (const value of [{ ...available, candidate: { ...candidate, releaseUrl: 'https://evil.example/download' } },
    { ...available, installation: { requestId: id, version: '0.1.6', status: 'success' } }]) {
    const invalid = createArchiveApi(async () => new Response(JSON.stringify({ ok: true, value })), 'http://127.0.0.1/');
    await assert.rejects(invalid.updates!(), ClientTransportError);
  }
});

test('native update card provides explicit EN/ZH confirmation and escapes release notes', async () => {
  const f = fixture(); await f.updates.check(); f.updates.review();
  for (const language of ['en', 'zh'] as const) {
    const t = translator(language); const html = renderToStaticMarkup(<UpdateCard controller={f.updates} Button={Button} t={t} />);
    assert.ok(html.includes(t('updateConfirm'))); assert.ok(html.includes(t('updateScope')));
    assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>'));
    assert.ok(html.includes(candidate.releaseUrl)); assert.match(html, /rel="noreferrer"/);
    assert.ok(!html.includes('updates/packages'));
  }
  f.updates.dispose(); f.archive.dispose();
});

test('normal update summary keeps version and actions compact, with policy and timing inside a closed disclosure', async t => {
  const current: UpdateOverview = { currentVersion: '0.1.5', installedVersion: '0.1.5', hostVersion: '0.2.1-rc.3', availability: 'current', canInstall: true, checkedAt: 100 };
  const f = fixture({ updates: async () => current }); t.after(() => { f.updates.dispose(); f.archive.dispose(); }); await f.updates.check();
  for (const language of ['en', 'zh'] as const) {
    const translate = translator(language); const html = renderToStaticMarkup(<UpdateCard controller={f.updates} Button={Button} t={translate} />);
    const disclosure = html.match(/<details class="dad-update-info">[\s\S]*?<\/details>/)?.[0]; assert.ok(disclosure);
    assert.ok(disclosure.includes(translate('updateAutomatic'))); assert.ok(disclosure.includes(translate('updateChecked', { time: new Date(100).toLocaleString() })));
    assert.ok(!disclosure.startsWith('<details open'));
    const summary = html.replace(disclosure, '').replace(/<[^>]+>/g, '');
    assert.ok(summary.includes('v0.1.5')); assert.ok(summary.includes(translate('updateCurrentCompact'))); assert.ok(summary.includes(translate('updateCheckCompact')));
    assert.ok(!summary.includes(translate('updateAutomatic'))); assert.ok(!summary.includes(translate('updateCurrentStatus')));
    assert.ok(!html.includes(translate('updateConfirm'))); assert.match(html, /role="status"/);
    assert.ok(html.includes(`aria-label="${translate('updateCheck')}"`));
  }
});

test('available update exposes review without showing release notes or confirmation until review is requested', async t => {
  const f = fixture(); t.after(() => { f.updates.dispose(); f.archive.dispose(); }); await f.updates.check();
  const translate = translator('en');
  const initial = renderToStaticMarkup(<UpdateCard controller={f.updates} Button={Button} t={translate} />);
  assert.ok(initial.includes(translate('updateReview'))); assert.ok(initial.includes(translate('updateAvailable', { version: candidate.version })));
  assert.ok(!initial.includes('&lt;script&gt;')); assert.ok(!initial.includes(translate('updateConfirm'))); assert.ok(!initial.includes(translate('updateScope')));
  f.updates.review();
  const reviewed = renderToStaticMarkup(<UpdateCard controller={f.updates} Button={Button} t={translate} />);
  assert.ok(reviewed.includes('&lt;script&gt;')); assert.ok(reviewed.includes(translate('updateConfirm'))); assert.ok(reviewed.includes(translate('updateScope')));
  f.updates.cancelReview();
  assert.ok(!renderToStaticMarkup(<UpdateCard controller={f.updates} Button={Button} t={translate} />).includes(translate('updateConfirm')));
});

test('compact error state remains actionable outside collapsed update details and never says up to date', async t => {
  const f = fixture({ updates: async () => ({ ...available, availability: 'error', code: 'update-network' }) });
  t.after(() => { f.updates.dispose(); f.archive.dispose(); }); await f.updates.check();
  for (const language of ['en', 'zh'] as const) {
    const translate = translator(language); const html = renderToStaticMarkup(<UpdateCard controller={f.updates} Button={Button} t={translate} />);
    const visible = html.replace(/<details class="dad-update-info">[\s\S]*?<\/details>/, '');
    assert.match(visible, /role="alert"/); assert.ok(visible.includes(translate('updateErrorNetwork')));
    assert.ok(visible.includes(translate('updateErrorCompact'))); assert.ok(!visible.includes(translate('updateCurrentCompact')));
    assert.ok(!visible.includes(translate('updateReview')));
  }
});

test('compact restart state distinguishes running and installed versions while preserving archive protection', async t => {
  const f = fixture({ updates: async () => ({ ...available, installedVersion: '0.1.6', installation: { requestId: randomUUID(), version: '0.1.6', status: 'restart-required' } }) });
  t.after(() => { f.updates.dispose(); f.archive.dispose(); }); await f.updates.check();
  const translate = translator('en'); const html = renderToStaticMarkup(<UpdateCard controller={f.updates} Button={Button} t={translate} />);
  const summary = html.replace(/<details class="dad-update-info">[\s\S]*?<\/details>/, '').replace(/<[^>]+>/g, '');
  assert.ok(summary.includes('v0.1.5')); assert.ok(summary.includes('v0.1.6')); assert.ok(summary.includes(translate('updateRestartCompact')));
  assert.ok(html.includes(translate('updateCurrent', { version: '0.1.5' }))); assert.ok(html.includes(translate('updateInstalled', { version: '0.1.6' })));
  assert.ok(html.includes(translate('updateRestart'))); assert.ok(!html.includes(translate('updateReview')));
  assert.equal(f.archive.getSnapshot().maintenance, true);
});

test('expanded update review keeps confirmation disabled during archive work and cancellation available', async t => {
  const f = fixture(); t.after(() => { f.updates.dispose(); f.archive.dispose(); }); await f.updates.check(); f.updates.review();
  const translate = translator('en'); const html = renderToStaticMarkup(<UpdateCard controller={f.updates} Button={Button} t={translate} archiveBusy />);
  const buttons = [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)];
  assert.ok(buttons.find(button => button[2] === translate('updateConfirm'))?.[1]?.includes('disabled'));
  assert.ok(!buttons.find(button => button[2] === translate('updateCancel'))?.[1]?.includes('disabled'));
});

test('a failed check disables an already open review confirmation while keeping the failure visible', async t => {
  let fail = false;
  const f = fixture({ updates: async () => { if (fail) throw new ClientTransportError('synthetic unavailable service'); return available; } });
  t.after(() => { f.updates.dispose(); f.archive.dispose(); }); await f.updates.check(); f.updates.review(); fail = true; await f.updates.check(true);
  const translate = translator('en'); const html = renderToStaticMarkup(<UpdateCard controller={f.updates} Button={Button} t={translate} />);
  const confirmation = [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].find(button => button[2] === translate('updateConfirm'));
  assert.ok(confirmation?.[1]?.includes('disabled')); assert.ok(html.includes(translate('updateErrorService')));
});
