import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createArchiveApi, startClient } from '../src/client.js';
import { ArchiveClientController, ClientTransportError, type ClientState } from '../src/client-state.js';
import { ArchiveDialogView, PreviewContent, ResultContent, en, zh, translator, type NativePrimitives } from '../src/client-ui.js';
import { ArchiveError, PACKAGE_NAME, type ArchiveApi, type BatchResult, type Overview, type Preview } from '../src/contracts.js';

const overview: Overview = {
  support: { supported: true, version: '0.2.1-rc.3', platform: 'darwin' },
  archived: [{ id: 'session-1', title: 'A sample conversation', workspace: 'Sample project', sizeBytes: 1024, descendantCount: 2 }], trash: [], recentResults: [],
};
const preview: Preview = { id: 'preview-1', action: 'trash', expiresAt: Date.now() + 60_000, items: [{ id: 'session-1', sessionId: 'session-1', title: 'A sample conversation', memberIds: ['session-1', 'subagent-1', 'subagent-2'], sizeBytes: 1024, disposition: 'pending' }] };
const result: BatchResult = { operationId: 'request-1', action: 'trash', items: [{ id: 'session-1', title: '<script>not html</script>', status: 'failed', message: 'Target is occupied.' }], counts: { succeeded: 0, pending: 0, skipped: 0, failed: 1 } };
const api: ArchiveApi = { list: async () => overview, preview: async () => preview, execute: async () => result, cancelPending: async () => result };
const primitives: NativePrimitives = {
  Button: ({ children, variant: _variant, size: _size, icon, ...props }) => <button {...props}>{icon}{children}</button>,
  Checkbox: ({ checked, onChange, label, disabled }) => <label><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} disabled={disabled} />{label}</label>,
  Modal: ({ open, onClose, title, closeLabel, description, children, footer }) => !open ? null : <div role="dialog" aria-modal="true" aria-label={title}><h2>{title}</h2><button aria-label={closeLabel} onClick={onClose} /><p>{description}</p>{children}<footer>{footer}</footer></div>,
};

test('English and Chinese dictionaries have identical keys and template fields', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  for (const key of Object.keys(en) as Array<keyof typeof en>) {
    assert.deepEqual([...en[key].matchAll(/\{([^}]+)\}/g)].map((item) => item[1]).sort(), [...zh[key].matchAll(/\{([^}]+)\}/g)].map((item) => item[1]).sort(), key);
  }
});

test('confirmation explains descendants, delayed movement, and retained data in both languages', () => {
  for (const language of ['en', 'zh'] as const) {
    const html = renderToStaticMarkup(<PreviewContent preview={preview} t={translator(language)} />);
    assert.match(html, /A sample conversation/);
    assert.match(html, /3/);
    assert.ok(html.includes(language === 'en' ? 'No disk space has been freed yet' : '目前尚未释放磁盘空间'));
    assert.ok(html.includes(language === 'en' ? 'Shared attachments' : '共享附件'));
    assert.ok(html.includes(language === 'en' ? 'project files' : '项目文件'));
  }
});

test('result rows escape host text and expose only failed-item retry controls', () => {
  const html = renderToStaticMarkup(<ResultContent result={result} t={translator('en')} retry={() => {}} disabled={false} Button={primitives.Button} />);
  assert.ok(html.includes('&lt;script&gt;not html&lt;/script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('Review and retry'));
  assert.ok(html.includes('0 succeeded'));
});

test('unsupported hosts retain a readable interface while mutation controls are disabled', () => {
  const state: ClientState = {
    open: true, tab: 'archived', overview: { ...overview, support: { supported: false, version: 'unsupported', platform: 'other', reason: 'Unsupported host.' } },
    selected: ['session-1'], loading: false, busy: false, preview: null, result: null, error: null, uncertainRequest: false,
  };
  const html = renderToStaticMarkup(<ArchiveDialogView state={state} controller={new ArchiveClientController(api)} primitives={primitives} t={translator('en')} />);
  assert.ok(html.includes('Data operations are unavailable'));
  assert.match(html, /disabled=""[^>]*>Move selected to trash/);
  assert.ok(html.includes('role="tablist"'));
  assert.ok(html.includes('role="tabpanel"'));
});

test('API calls preserve the deployment prefix and send IDs only through the authenticated gateway', async () => {
  const sent: Array<{ url: string; init: RequestInit }> = [];
  const transport: typeof fetch = async (url, init) => {
    sent.push({ url: String(url), init: init! });
    return new Response(JSON.stringify({ ok: true, value: preview }), { status: 200 });
  };
  await createArchiveApi(transport, 'https://example.test/dsh/').preview('trash', ['session-1']);
  assert.equal(sent[0]?.url, 'https://example.test/dsh/api/dsh-archive-delete');
  assert.equal(sent[0]?.init.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(String(sent[0]?.init.body)), { action: 'preview', operation: 'trash', ids: ['session-1'] });
});

test('API distinguishes known host refusals from unknown transport outcomes', async () => {
  const known: typeof fetch = async () => new Response(JSON.stringify({ ok: false, error: { code: 'busy', message: 'Still running.' } }), { status: 409 });
  await assert.rejects(createArchiveApi(known, 'dsh-app://app/').execute('preview-1', 'request-1'), (error) => error instanceof ArchiveError && error.code === 'busy');
  const malformed: typeof fetch = async () => new Response('<html>not a response</html>', { status: 502 });
  await assert.rejects(createArchiveApi(malformed, 'dsh-app://app/').execute('preview-1', 'request-1'), ClientTransportError);
});

test('client registers native slots and disposes every contribution without a network request', () => {
  const registrations: Array<{ options: { name: string; key?: string; id?: string }; component: React.ComponentType<unknown> }> = [];
  const effects: Array<() => void> = [];
  let disposedSlots = 0;
  let reads = 0;
  const plugin = startClient(() => ({ ...primitives, MenuItemButton: ({ children }: { children: React.ReactNode }) => <button role="menuitem">{children}</button> }), () => ({ ...api, list: async () => { reads++; return overview; } }));
  const context = {
    locale: { register: () => () => {} },
    workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }), subscribe: () => () => {} } },
    slots: {
      inject: (_name: string, run: () => (() => void) | void) => { const stop = run(); return () => { stop?.(); }; },
      register: <P,>(options: { name: string; key?: string; id?: string }, component: React.ComponentType<P>) => { registrations.push({ options, component: component as React.ComponentType<unknown> }); return () => { disposedSlots++; }; },
    },
    effect: (run: () => (() => void)) => { effects.push(run()); },
  };
  plugin.apply(context);
  assert.deepEqual(registrations.map((item) => item.options.name), ['sidebar.workspaces.session.menu.item', 'shell.overlay', 'plugins.bundle.config']);
  assert.equal(registrations[2]?.options.key, PACKAGE_NAME);
  assert.equal(reads, 0);
  for (const dispose of effects.reverse()) dispose();
  assert.equal(disposedSlots, 3);
});
