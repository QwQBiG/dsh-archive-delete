import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArchiveClientController } from '../src/client-state.js';
import { UpdateClientController } from '../src/update-client.js';
import { UpdateCard } from '../src/update-ui.js';
import { translator, type NativePrimitives } from '../src/client-ui.js';
import type { ArchiveApi } from '../src/contracts.js';
import type { UpdateOverview } from '../src/update-contracts.js';

const Button: NativePrimitives['Button'] = ({ children, variant: _variant, size: _size, icon, ...props }) => <button {...props}>{icon}{children}</button>;
const candidate = { id: 'next-release', version: '0.0.4', requiredDshVersion: '0.2.1-rc.5', publishedAt: '2026-11-13T00:00:00Z',
  releaseUrl: 'https://github.com/QwQBiG/dsh-archive-delete/releases/tag/v0.0.4', notes: 'Next release', assetBytes: 1000 };
const completed: UpdateOverview = { currentVersion: '0.0.3', installedVersion: '0.0.3', hostVersion: '0.2.1-rc.5', availability: 'current', canInstall: true,
  installation: { requestId: randomUUID(), version: '0.0.3', status: 'installed' } };

for (const availability of ['available', 'error', 'current', 'incompatible'] as const) test(`a historical successful upgrade does not hide ${availability} discovery`, async t => {
  const data: UpdateOverview = availability === 'available' ? { ...completed, availability, candidate }
    : { ...completed, availability, ...(availability === 'error' ? { code: 'update-network' } : {}) };
  const unexpected = async (): Promise<never> => { throw Error('Unexpected archive request'); };
  const api: ArchiveApi = { list: unexpected, preview: unexpected, execute: unexpected, cancelPending: unexpected,
    updates: async () => data, installUpdate: unexpected };
  const archive = new ArchiveClientController(api); const updates = new UpdateClientController(api, archive);
  t.after(() => { updates.dispose(); archive.dispose(); });
  await updates.check();
  for (const language of ['en', 'zh'] as const) {
    const translate = translator(language); const html = renderToStaticMarkup(<UpdateCard controller={updates} Button={Button} t={translate} />);
    const compact = html.replace(/<details class="dad-update-info">[\s\S]*?<\/details>/, '');
    if (availability === 'available') {
      assert.ok(compact.includes(translate('updateAvailable', { version: candidate.version })), 'the next version must appear in the compact summary');
      assert.ok(html.includes(translate('updateReview')));
    } else if (availability === 'error') {
      assert.ok(compact.includes(translate('updateErrorCompact')), 'the compact summary must reflect the failed check');
      assert.ok(html.includes(translate('updateErrorNetwork')), 'details must explain the current check failure');
    } else {
      assert.ok(compact.includes(translate(availability === 'current' ? 'updateCurrentCompact' : 'updateIncompatibleCompact')));
      assert.ok(html.includes(translate(availability === 'current' ? 'updateCurrentStatus' : 'updateIncompatible')));
    }
    assert.ok(!compact.includes(translate('updateDoneCompact')));
  }
});

for (const status of ['installing', 'unknown', 'restart-required'] as const) test(`active ${status} state takes precedence over a discovered release`, async t => {
  const data: UpdateOverview = { ...completed, availability: 'available', candidate,
    ...(status === 'restart-required' ? { installedVersion: candidate.version } : {}),
    installation: { requestId: randomUUID(), version: candidate.version, status } };
  const unexpected = async (): Promise<never> => { throw Error('Unexpected archive request'); };
  const api: ArchiveApi = { list: unexpected, preview: unexpected, execute: unexpected, cancelPending: unexpected,
    updates: async () => data, installUpdate: unexpected };
  const archive = new ArchiveClientController(api); const updates = new UpdateClientController(api, archive);
  t.after(() => { updates.dispose(); archive.dispose(); }); await updates.check();
  for (const language of ['en', 'zh'] as const) {
    const translate = translator(language); const html = renderToStaticMarkup(<UpdateCard controller={updates} Button={Button} t={translate} />);
    const compact = html.replace(/<details class="dad-update-info">[\s\S]*?<\/details>/, '');
    const key = status === 'installing' ? 'updateInstallingCompact' : status === 'unknown' ? 'updateUncertainCompact' : 'updateRestartCompact';
    assert.ok(compact.includes(translate(key))); assert.ok(!html.includes(translate('updateReview')));
    assert.ok(!compact.includes(translate('updateAvailable', { version: candidate.version })));
  }
  assert.equal(archive.getSnapshot().maintenance, true);
});

for (const status of ['interrupted', 'failed'] as const) test(`a same-version ${status} attempt stays visible alongside a fresh check`, async t => {
  const installation = { requestId: randomUUID(), version: completed.installedVersion, status, code: 'update-host-failed' };
  let data: UpdateOverview = { ...completed, availability: 'unknown', installation };
  const unexpected = async (): Promise<never> => { throw Error('Unexpected request'); };
  const api: ArchiveApi = { list: unexpected, preview: unexpected, execute: unexpected, cancelPending: unexpected,
    updates: async () => data, installUpdate: unexpected };
  const archive = new ArchiveClientController(api); const updates = new UpdateClientController(api, archive);
  t.after(() => { updates.dispose(); archive.dispose(); });
  await updates.check();

  for (const availability of ['current', 'available', 'error'] as const) {
    data = { ...completed, availability, installation, ...(availability === 'available' ? { candidate } : {}),
      ...(availability === 'error' ? { code: 'update-network' } : {}) };
    await updates.check(true);
    assert.equal(archive.getSnapshot().maintenance, false);
    for (const language of ['en', 'zh'] as const) {
      const translate = translator(language);
      const html = renderToStaticMarkup(<UpdateCard controller={updates} Button={Button} t={translate} />);
      const compact = html.replace(/<details class="dad-update-info">[\s\S]*?<\/details>/, '').replace(/<[^>]+>/g, ' ');
      const attempt = translate(status === 'interrupted' ? 'updateInterrupted' : 'updateFailed', { version: installation.version });
      assert.ok(compact.includes(attempt));
      assert.ok(!compact.includes(installation.code));
      assert.ok(html.includes(`${translate('updateAttemptDetails')}: </span><code>${installation.code}</code>`));
      if (availability === 'available') {
        assert.ok(compact.includes(translate('updateAvailable', { version: candidate.version })));
        assert.ok(compact.includes(translate('updateReview')));
      } else {
        assert.ok(compact.includes(translate(availability === 'current' ? 'updateCurrentCompact' : 'updateErrorCompact')));
        assert.ok(!compact.includes(translate('updateReview')));
        if (availability === 'error') assert.ok(html.includes(translate('updateErrorNetwork')));
      }
    }
    if (availability === 'available') {
      updates.review();
      assert.equal(updates.getSnapshot().reviewId, candidate.id);
      updates.cancelReview();
    }
  }
});
