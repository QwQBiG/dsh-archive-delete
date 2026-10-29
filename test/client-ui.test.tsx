import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createArchiveApi, startClient } from '../src/client.js';
import { ArchiveClientController, ClientTransportError, type ClientState } from '../src/client-state.js';
import { ArchiveDialogView, PreviewContent, ResultContent, StorageResultContent, en, zh, translator, localizeReason, type NativePrimitives } from '../src/client-ui.js';
import { ArchiveError, PACKAGE_NAME, type ArchiveApi, type BatchResult, type Overview, type Preview, type StorageOverview } from '../src/contracts.js';

const overview: Overview = {
  support: { supported: true, version: '0.2.1-rc.3', platform: 'darwin' },
  archived: [{ id: 'session-1', title: 'A sample conversation', workspace: 'Sample project', sizeBytes: 1024, descendantCount: 2 }], trash: [], recentResults: [],
};
const preview: Preview = { id: 'preview-1', action: 'trash', expiresAt: Date.now() + 60_000, items: [{ id: 'session-1', sessionId: 'session-1', title: 'A sample conversation', memberIds: ['session-1', 'subagent-1', 'subagent-2'], sizeBytes: 1024, disposition: 'pending' }] };
const result: BatchResult = { operationId: 'request-1', action: 'trash', items: [{ id: 'session-1', title: '<script>not html</script>', status: 'failed', message: 'Target is occupied.' }], counts: { succeeded: 0, pending: 0, skipped: 0, failed: 1 } };
const api: ArchiveApi = { list: async () => overview, preview: async () => preview, execute: async () => result, cancelPending: async () => result };
const viewDefaults = () => ({ sort: 'default' as const, storage: { workspaceId: '', scanning: false, result: null, error: null, cancelled: false } });
function storageResult(): StorageOverview {
  const counters = { entries: 3, files: 2, directories: 1, symlinks: 1, unreadable: 0, changed: 0, unsupported: 0, crossDevice: 0, depthLimit: 0, duplicateHardlinks: 0, duplicatePaths: 0, identityUnknown: 1, excluded: 0 };
  return { metric: 'logical-file-bytes', scope: 'workspace', workspaceId: 'project-1', workspaces: [{ id: 'project-1', title: 'A sample project' }], startedAt: 100, finishedAt: 120, durationMs: 20,
    complete: false, fileBytes: 2048, referencedBytes: 4096, fileCount: 2, uniqueFileCount: 1, duplicateHardlinks: 1, duplicatePaths: 0, identityUnknown: 1,
    categories: [{ id: 'workspace', kind: 'workspace', label: 'A sample project', readOnly: true, status: 'partial', fileBytes: 2048, referencedBytes: 4096, fileCount: 2, uniqueFileCount: 1, counters,
      issues: [{ code: 'time-budget' }, { code: 'link-skipped', relativePath: 'linked-folder' }], overlaps: ['unavailable'], largestFiles: [{ relativePath: 'output/ai-generated-cache.tmp', sizeBytes: 2048, source: 'unknown' }], directories: [{ relativePath: 'output', fileBytes: 4096, fileCount: 2 }] },
    { id: 'unavailable', kind: 'attachment-cache', readOnly: true, status: 'unavailable', fileBytes: null, referencedBytes: null, fileCount: 0, uniqueFileCount: 0, counters: { ...counters, entries: 0, files: 0, symlinks: 0, identityUnknown: 0 }, issues: [{ code: 'root-unresolved' }], overlaps: ['workspace'], largestFiles: [], directories: [] }] };
}
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

test('storage tab has three keyboard-addressable tabs, explicit scan controls and no archive mutation buttons', async () => {
  const current = { ...overview, storageWorkspaces: storageResult().workspaces };
  let scans = 0;
  const controller = new ArchiveClientController({ ...api, list: async () => current, storage: async () => { scans++; return storageResult(); } });
  await controller.open(); controller.setTab('storage');
  for (const language of ['en', 'zh'] as const) {
    const html = renderToStaticMarkup(<ArchiveDialogView state={controller.getSnapshot()} controller={controller} primitives={primitives} t={translator(language)} />);
    const t = translator(language);
    assert.equal((html.match(/role="tab"/g) ?? []).length, 3);
    assert.ok(html.includes(t('storage')));
    assert.ok(html.includes(t('storageHostScan')));
    assert.ok(html.includes(t('storageRefreshWorkspaces')));
    assert.ok(html.includes('A sample project'));
    assert.ok(html.includes(t('storageEmptyHint')));
    assert.match(html, /disabled=""[^>]*>[^<]*<\/button>/);
    assert.ok(!html.includes(t('moveSelected')));
    assert.ok(!html.includes(t('purgeSelected')));
    assert.ok(!html.includes(t('restoreSelected')));
    assert.ok(!html.includes('type="checkbox"'));
    assert.match(html, /role="tabpanel"/);
  }
  assert.equal(scans, 0);
  controller.dispose();
});

test('storage refusals explain the available next step in either language', async () => {
  const controller = new ArchiveClientController({ ...api, storage: async () => storageResult() });
  await controller.open(); controller.setTab('storage');
  const reasons = { 'scan-busy': 'storageReasonBusy', 'scan-closed': 'storageReasonClosed',
    'workspace-changed': 'storageReasonWorkspaceChanged', 'workspace-not-found': 'storageReasonWorkspaceMissing', 'unsafe-workspace': 'storageReasonUnsafeWorkspace' } as const;
  for (const language of ['en', 'zh'] as const) for (const [code, key] of Object.entries(reasons)) {
    const state = controller.getSnapshot();
    const html = renderToStaticMarkup(<ArchiveDialogView state={{ ...state, storage: { ...state.storage, error: { code, message: 'English host diagnostic', uncertain: false } } }} controller={controller} primitives={primitives} t={translator(language)} />);
    assert.ok(html.includes(translator(language)(key)));
    assert.ok(!html.includes('English host diagnostic'));
  }
  controller.dispose();
});

test('partial storage reports show unknown bytes, limits, relative files and unknown origin without cleanup actions', () => {
  for (const language of ['en', 'zh'] as const) {
    const t = translator(language);
    const html = renderToStaticMarkup(<StorageResultContent result={storageResult()} t={t} />);
    assert.ok(html.includes(t('storageMeasured')));
    assert.ok(html.includes('2.0 KiB'));
    assert.ok(html.includes('4.0 KiB'));
    assert.ok(html.includes(t('storagePartial')));
    assert.ok(html.includes(t('storageIssueTime')));
    assert.ok(html.includes(t('storageIssueLink')));
    assert.ok(html.includes(t('storageSource')));
    assert.ok(html.includes(t('storageProvenance')));
    assert.ok(html.includes(t('storageMetric')));
    assert.ok(html.includes(t('storageOverlap')));
    assert.ok(html.includes(t('storageIdentity', { n: 1 })));
    assert.ok(html.includes('output/ai-generated-cache.tmp'));
    assert.ok(html.includes(t('storageCategoryAttachmentCache')));
    assert.match(html, new RegExp(`${t('storageUnknown')}<\/span>`));
    assert.ok(!html.includes('<button'));
    assert.ok(!html.includes('0 B'));
    assert.ok(!html.includes('/Users/'));
    assert.ok(!html.includes(t('storageFiles', { unique: 2, paths: 2 })), 'folder aliases must not be labelled unique files');
    assert.match(html, /<time dateTime="1970-01-01T00:00:00\.120Z"/);
  }
  const unknown = { ...storageResult(), fileBytes: 0, categories: [storageResult().categories[1]!] };
  const html = renderToStaticMarkup(<StorageResultContent result={unknown} t={translator('en')} />);
  assert.match(html, /dad-storage-size">Unknown<\/strong>/);
  assert.ok(!html.includes('0 B'));
});

test('archive and trash size sort controls render native selects in either language', async () => {
  const controller = new ArchiveClientController(api);
  await controller.open(); controller.setSort('size-desc');
  for (const tab of ['archived', 'trash'] as const) {
    controller.setTab(tab);
    for (const language of ['en', 'zh'] as const) {
      const html = renderToStaticMarkup(<ArchiveDialogView state={controller.getSnapshot()} controller={controller} primitives={primitives} t={translator(language)} />);
      assert.ok(html.includes(translator(language)('sortSize')));
      assert.match(html, /<option value="size-desc" selected=""/);
    }
  }
  controller.dispose();
});

test('storage API sends only registered IDs to the gateway and forwards cancellation', async () => {
  const sent: Array<{ url: string; init: RequestInit }> = [];
  const transport: typeof fetch = async (url, init) => { sent.push({ url: String(url), init: init! }); return new Response(JSON.stringify({ ok: true, value: storageResult() }), { status: 200 }); };
  const abort = new AbortController();
  const returned = await createArchiveApi(transport, 'https://example.test/dsh/').storage!('project-1', abort.signal);
  assert.equal(returned.categories[1]!.fileBytes, null);
  assert.equal(sent[0]!.url, 'https://example.test/dsh/api/dsh-archive-delete');
  assert.equal(sent[0]!.init.credentials, 'same-origin');
  assert.equal(sent[0]!.init.signal, abort.signal);
  assert.deepEqual(JSON.parse(String(sent[0]!.init.body)), { action: 'storage', workspaceId: 'project-1' });
  assert.ok(!String(sent[0]!.init.body).includes('path'));
});

test('storage API refuses invalid byte counts, writable categories, absolute paths and invented file provenance', async () => {
  const valid = storageResult();
  const category = valid.categories[0]!;
  for (const invalid of [
    { ...valid, fileBytes: -1 },
    { ...valid, categories: [{ ...category, readOnly: false }] },
    { ...valid, categories: [{ ...category, largestFiles: [{ ...category.largestFiles[0]!, relativePath: '/Users/private.txt' }] }] },
    { ...valid, categories: [{ ...category, directories: [{ relativePath: '../escape', fileBytes: 2, fileCount: 1 }] }] },
    { ...valid, categories: [{ ...category, largestFiles: [{ ...category.largestFiles[0]!, source: 'ai-generated' }] }] },
  ]) {
    const transport: typeof fetch = async () => new Response(JSON.stringify({ ok: true, value: invalid }), { status: 200 });
    await assert.rejects(createArchiveApi(transport, 'https://example.test/').storage!('project-1'), ClientTransportError);
  }
});

test('an incompatible host shows current version, required version and upgrade instructions in either language', () => {
  const state: ClientState = { ...viewDefaults(), open: true, tab: 'archived', page: 0, overview: { ...overview, support: {
    supported: false, version: '0.2.1-rc.2', platform: 'win32',
    reason: 'DSH Desktop 0.2.1-rc.3 is required; the current runtime is 0.2.1-rc.2. Update DSH Desktop to the required version, then restart this plugin.',
  } }, selected: [], loading: false, busy: false, preview: null, result: null, error: null, uncertainRequest: false };
  for (const language of ['en', 'zh'] as const) {
    const html = renderToStaticMarkup(<ArchiveDialogView state={state} controller={new ArchiveClientController(api)} primitives={primitives} t={translator(language)} />);
    assert.match(html, /0\.2\.1-rc\.2/);
    assert.match(html, /0\.2\.1-rc\.3/);
    assert.ok(html.includes(language === 'en' ? 'Update DSH Desktop' : '请将 DSH 桌面端更新至'));
    assert.ok(!html.includes('current runtime is'));
    assert.match(html, /disabled=""/);
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

test('pending rows expose explicit cancellation-and-review while staying outside bulk selection', async () => {
  const current: Overview = { ...overview, archived: [{ ...overview.archived[0]!, pending: true }] };
  const controller = new ArchiveClientController({ ...api, list: async () => current });
  await controller.open(); controller.selectAll(true);
  assert.deepEqual(controller.getSnapshot().selected, []);
  for (const language of ['en', 'zh'] as const) {
    const html = renderToStaticMarkup(<ArchiveDialogView state={controller.getSnapshot()} controller={controller} primitives={primitives} t={translator(language)} />);
    assert.ok(html.includes(language === 'en' ? 'Cancel waiting and review' : '取消等待并重新核对'));
    assert.ok(html.includes(language === 'en' ? 'Cancel pending move' : '取消待处理'));
    assert.match(html, /<label><input[^>]*disabled=""[^>]*\/>A sample conversation<\/label>/);
    assert.ok(html.includes(language === 'en' ? 'without restarting' : '无需重启'));
  }
  controller.dispose();
});

test('known host refusal reasons are localized while unfamiliar diagnostics retain their fallback', () => {
  assert.equal(localizeReason('active', 'English host detail', translator('zh')), zh.reasonActive);
  assert.equal(localizeReason('source-changed', 'English host detail', translator('zh')), zh.reasonChanged);
  assert.equal(localizeReason('ambiguous-lifecycle', 'English host detail', translator('zh')), zh.reasonLifecycle);
  assert.equal(localizeReason('release-failed', 'English host detail', translator('zh')), zh.reasonRelease);
  assert.equal(localizeReason('unknown-future-code', 'Future host detail', translator('zh')), 'Future host detail');
  const state: ClientState = { ...viewDefaults(), open: true, tab: 'archived', page: 0, overview: { ...overview, support: { supported: false, version: 'unknown', platform: 'darwin', reason: 'Archive storage could not be initialized. Check the host diagnostics, then reload the plugin.' } }, selected: [], loading: false, busy: false, preview: null, result: null, error: null, uncertainRequest: false };
  const html = renderToStaticMarkup(<ArchiveDialogView state={state} controller={new ArchiveClientController(api)} primitives={primitives} t={translator('zh')} />);
  assert.ok(html.includes(zh.reasonInitialization));
  assert.ok(!html.includes('Archive storage could not be initialized'));
});

test('result rows escape host text and expose only failed-item retry controls', () => {
  const html = renderToStaticMarkup(<ResultContent result={result} t={translator('en')} retry={() => {}} disabled={false} Button={primitives.Button} />);
  assert.ok(html.includes('&lt;script&gt;not html&lt;/script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('Review and retry'));
  assert.ok(html.includes('0 succeeded'));
  assert.match(html, /<details[^>]*open=""/);
});

test('successful result details stay compact and page controls expose only current-page records', async () => {
  const completed = { ...result, items: [{ ...result.items[0]!, status: 'moved' as const }], counts: { succeeded: 1, pending: 0, skipped: 0, failed: 0 } };
  const resultHtml = renderToStaticMarkup(<ResultContent result={completed} t={translator('en')} retry={() => {}} disabled={false} Button={primitives.Button} />);
  assert.ok(!resultHtml.includes('open=""'));
  const many: Overview = { ...overview, archived: Array.from({ length: 101 }, (_, i) => ({ id: `s-${i}`, title: `Title ${i}`, workspace: 'QA', sizeBytes: 10, descendantCount: 0 })) };
  const controller = new ArchiveClientController({ ...api, list: async () => many });
  await controller.open(); controller.setPage(1); controller.selectAll(true);
  const html = renderToStaticMarkup(<ArchiveDialogView state={controller.getSnapshot()} controller={controller} primitives={primitives} t={translator('en')} />);
  assert.ok(html.includes('Page 2 of 2'));
  assert.ok(html.includes('Title 100'));
  assert.ok(!html.includes('Title 99'));
  assert.ok(html.includes('data-selected="true"'));
  assert.ok(html.includes('Select all (1)'));
});

test('unsupported hosts retain a readable interface while mutation controls are disabled', () => {
  const state: ClientState = {
    ...viewDefaults(),
    open: true, tab: 'archived', page: 0, overview: { ...overview, support: { supported: false, version: 'unsupported', platform: 'other', reason: 'Unsupported host.' } },
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
