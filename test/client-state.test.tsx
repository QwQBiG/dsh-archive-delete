import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { ArchiveClientController, ClientTransportError, canExecutePreview, visibleSelection, PAGE_SIZE, pageCount } from '../src/client-state.js';
import { ArchiveError, type ArchiveApi, type BatchResult, type Overview, type Preview, type StorageOverview } from '../src/contracts.js';
import { fixture, present } from './fixtures.js';

function overview(): Overview {
  return {
    support: { supported: true, version: '0.2.1-rc.3', platform: 'darwin' },
    archived: [
      { id: 'archive-a', title: 'A', workspace: '/sample', sizeBytes: 12, descendantCount: 0 },
      { id: 'archive-b', title: 'B', workspace: '/sample', sizeBytes: 24, descendantCount: 1 },
      { id: 'pending-c', title: 'C', workspace: '/sample', sizeBytes: 36, descendantCount: 0, pending: true },
    ],
    trash: [{ id: 'trash-a', sessionId: 'source-a', title: 'Trashed', trashedAt: 1, sizeBytes: 48, memberCount: 1 }],
    recentResults: [],
  };
}
function preview(action: 'trash' | 'restore' | 'purge' = 'trash'): Preview {
  return { id: `preview-${action}`, action, expiresAt: 20_000, items: [{ id: 'archive-a', title: 'A', sessionId: 'archive-a', memberIds: ['archive-a'], sizeBytes: 12, disposition: 'ready' }] };
}
function result(operationId = 'request-1'): BatchResult {
  return { operationId, action: 'trash', items: [{ id: 'archive-a', title: 'A', status: 'moved' }], counts: { succeeded: 1, pending: 0, skipped: 0, failed: 0 } };
}
function cancelled(id = 'pending-c', operationId = 'cancel-request'): BatchResult {
  return { operationId, action: 'cancel', items: [{ id, title: '', status: 'cancelled' }], counts: { succeeded: 1, pending: 0, skipped: 0, failed: 0 } };
}
function api(overrides: Partial<ArchiveApi> = {}): ArchiveApi {
  return {
    list: async () => overview(), preview: async (action) => preview(action),
    execute: async (_preview, requestId) => result(requestId),
    cancelPending: async (_ids, requestId) => ({ ...result(requestId), action: 'cancel', items: [{ id: 'pending-c', title: 'C', status: 'cancelled' }] }),
    ...overrides,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function storageOverview(workspaceId?: string): StorageOverview {
  return { metric: 'logical-file-bytes', scope: workspaceId ? 'workspace' : 'host', ...(workspaceId ? { workspaceId } : {}),
    workspaces: [{ id: 'project-1', title: 'First project' }, { id: 'project-2', title: 'Second project' }],
    startedAt: 100, finishedAt: 110, durationMs: 10, complete: true, fileBytes: 0, referencedBytes: 0,
    fileCount: 0, uniqueFileCount: 0, duplicateHardlinks: 0, duplicatePaths: 0, identityUnknown: 0, categories: [] };
}

test('size sorting is immutable and changing sort clears the page, preview and visible selection', async () => {
  const current = overview();
  current.archived = Array.from({ length: 105 }, (_, i) => ({ id: `archive-${i}`, title: `Conversation ${i}`, workspace: 'QA', sizeBytes: i, descendantCount: 0 }));
  current.trash.push({ ...current.trash[0]!, id: 'trash-large', sessionId: 'source-large', sizeBytes: 900 });
  const originalIds = current.archived.map(item => item.id);
  const requested: string[][] = [];
  const controller = new ArchiveClientController(api({ list: async () => current, preview: async (_action, ids) => { requested.push(ids); return preview(); } }));
  await controller.open();
  controller.setPage(1); controller.selectAll(true);
  await controller.preview('trash');
  controller.setSort('size-desc');
  assert.equal(controller.getSnapshot().page, 0);
  assert.deepEqual(controller.getSnapshot().selected, []);
  assert.equal(controller.getSnapshot().preview, null);
  controller.selectAll(true);
  assert.equal(controller.getSnapshot().selected[0], 'archive-104');
  assert.equal(controller.getSnapshot().selected.at(-1), 'archive-5');
  assert.deepEqual(current.archived.map(item => item.id), originalIds);
  controller.setTab('trash'); controller.selectAll(true);
  assert.deepEqual(controller.getSnapshot().selected, ['trash-large', 'trash-a']);
  controller.close();
  await controller.open('archive-0');
  assert.equal(controller.getSnapshot().page, 1);
  assert.deepEqual(controller.getSnapshot().selected, ['archive-0']);
  assert.deepEqual(requested.at(-1), ['archive-0']);
  assert.deepEqual(current.trash.map(item => item.id), ['trash-a', 'trash-large']);
});

test('storage is a read-only tab: no scan on open, no selection and workspace scans require an explicit registered ID', async () => {
  const requests: Array<string | undefined> = [];
  const current = { ...overview(), storageWorkspaces: storageOverview().workspaces };
  let mutations = 0;
  const controller = new ArchiveClientController(api({ list: async () => current, storage: async workspaceId => { requests.push(workspaceId); return storageOverview(workspaceId); }, execute: async () => { mutations++; return result(); } }));
  await controller.open(); controller.selectAll(true);
  controller.setTab('storage'); controller.selectAll(true); controller.toggle('archive-a');
  assert.deepEqual(controller.getSnapshot().selected, []);
  assert.equal(pageCount(controller.getSnapshot()), 1);
  assert.deepEqual(requests, []);
  await controller.scanStorage('workspace');
  controller.setStorageWorkspace('/unregistered/path');
  await controller.scanStorage('workspace');
  assert.deepEqual(requests, []);
  controller.setStorageWorkspace('project-1');
  assert.deepEqual(requests, []);
  await controller.scanStorage('workspace');
  await controller.scanStorage('host');
  await controller.preview('trash', ['archive-a']);
  assert.deepEqual(requests, ['project-1', undefined]);
  assert.equal(controller.getSnapshot().storage.result?.scope, 'host');
  assert.equal(controller.getSnapshot().preview, null);
  assert.equal(controller.getSnapshot().loading, false);
  assert.equal(controller.getSnapshot().busy, false);
  assert.equal(mutations, 0);
});

test('only the latest storage request can publish results even when transport ignores cancellation', async () => {
  const first = deferred<StorageOverview>();
  const second = deferred<StorageOverview>();
  const requests: Array<{ id: string | undefined; signal: AbortSignal | undefined }> = [];
  const controller = new ArchiveClientController(api({ list: async () => ({ ...overview(), storageWorkspaces: storageOverview().workspaces }), storage: (id, signal) => { requests.push({ id, signal }); return requests.length === 1 ? first.promise : second.promise; } }));
  await controller.open(); controller.setTab('storage');
  const old = controller.scanStorage('host');
  controller.setStorageWorkspace('project-2');
  const fresh = controller.scanStorage('workspace');
  assert.equal(requests[0]!.signal?.aborted, true);
  assert.equal(requests[1]!.signal?.aborted, false);
  second.resolve(storageOverview('project-2')); await fresh;
  const published = controller.getSnapshot();
  first.resolve(storageOverview()); await old;
  assert.equal(controller.getSnapshot(), published);
  assert.equal(controller.getSnapshot().storage.result?.workspaceId, 'project-2');
});

test('cancelling, leaving, closing or disposing aborts a scan and rejects its late response without a new state update', async () => {
  for (const leave of ['cancel', 'tab', 'close', 'dispose'] as const) {
    const pending = deferred<StorageOverview>();
    let signal: AbortSignal | undefined;
    const controller = new ArchiveClientController(api({ storage: (_id, received) => { signal = received; return pending.promise; } }));
    await controller.open(); controller.setTab('storage');
    const scan = controller.scanStorage('host');
    if (leave === 'cancel') controller.cancelStorage();
    else if (leave === 'tab') controller.setTab('trash');
    else if (leave === 'close') controller.close();
    else controller.dispose();
    assert.equal(signal?.aborted, true, leave);
    const afterLeaving = controller.getSnapshot();
    if (leave === 'close') pending.reject(new Error('Late scan failure'));
    else pending.resolve(storageOverview());
    await scan;
    assert.equal(controller.getSnapshot(), afterLeaving, leave);
    assert.equal(controller.getSnapshot().storage.result, null, leave);
    assert.equal(controller.getSnapshot().storage.scanning, false, leave);
  }
});

test('storage failure and mismatched scope stay separate from mutation state and a removed workspace aborts its scan', async () => {
  let current: Overview = { ...overview(), storageWorkspaces: storageOverview().workspaces };
  const pending = deferred<StorageOverview>();
  let signal: AbortSignal | undefined;
  let calls = 0;
  const controller = new ArchiveClientController(api({ list: async () => current, storage: (_id, received) => {
    calls++; signal = received;
    if (calls === 1) return Promise.reject(new ArchiveError('storage-unavailable', 'Provider missing.'));
    if (calls === 2) return Promise.resolve(storageOverview('project-1'));
    return pending.promise;
  } }));
  await controller.open(); controller.setTab('storage');
  await controller.scanStorage('host');
  assert.equal(controller.getSnapshot().storage.error?.code, 'storage-unavailable');
  assert.equal(controller.getSnapshot().error, null);
  assert.equal(controller.getSnapshot().uncertainRequest, false);
  await controller.scanStorage('host');
  assert.equal(controller.getSnapshot().storage.error?.code, 'request-failed');
  controller.setStorageWorkspace('project-1');
  const scan = controller.scanStorage('workspace');
  current = { ...current, storageWorkspaces: [] };
  await controller.refresh();
  assert.equal(signal?.aborted, true);
  assert.equal(controller.getSnapshot().storage.workspaceId, '');
  pending.resolve(storageOverview('project-1')); await scan;
  assert.equal(controller.getSnapshot().storage.result, null);
  assert.equal(controller.getSnapshot().error, null);
});

test('selection is limited to the active tab and cannot include pending entries', async () => {
  const controller = new ArchiveClientController(api());
  await controller.open();
  controller.selectAll(true);
  assert.deepEqual(controller.getSnapshot().selected, ['archive-a', 'archive-b']);
  controller.toggle('pending-c');
  controller.toggle('not-in-list');
  assert.deepEqual(controller.getSnapshot().selected, ['archive-a', 'archive-b']);
  controller.setTab('trash');
  assert.deepEqual(controller.getSnapshot().selected, []);
  controller.selectAll(true);
  assert.deepEqual(visibleSelection(controller.getSnapshot()), ['trash-a']);
  controller.setTab('archived');
  assert.deepEqual(controller.getSnapshot().selected, []);
});

test('one open controller moves and permanently deletes real trash logs without reopening the service or dialog', async t => {
  const f = await fixture();
  const controller = new ArchiveClientController(f.service);
  t.after(async () => { controller.dispose(); await f.service.close(); await f.close(); });
  const group = await f.add('immediate-parent', ['immediate-child']);
  await controller.open(group.sessionId);
  assert.equal(controller.getSnapshot().preview?.action, 'trash');
  await controller.confirm();
  assert.equal(controller.getSnapshot().result?.items[0]?.status, 'moved');
  const entry = controller.getSnapshot().overview?.trash[0]; assert.ok(entry);
  const directory = join(f.store.root, 'trash', entry.id);
  assert.equal(await present(directory), true);
  controller.setTab('trash'); controller.toggle(entry.id);
  await controller.preview('purge');
  assert.equal(controller.getSnapshot().preview?.items[0]?.disposition, 'ready');
  // This is the same controller and service; no close, initialize or reopen occurs.
  await controller.confirm();
  assert.equal(controller.getSnapshot().open, true);
  assert.equal(controller.getSnapshot().result?.items[0]?.status, 'purged');
  assert.equal(controller.getSnapshot().result?.counts.pending, 0);
  assert.deepEqual(controller.getSnapshot().overview?.trash, []);
  assert.equal(await present(directory), false);
  for (const member of group.members) assert.equal(await present(member.directory), false);
  assert.equal(f.adapter.locks, 0);
});

test('an occupied trash entry stays visible and unchanged when immediate permanent deletion is refused', async t => {
  const f = await fixture();
  const controller = new ArchiveClientController(f.service);
  t.after(async () => { controller.dispose(); await f.service.close(); await f.close(); });
  const group = await f.add('occupied-trash');
  await controller.open(group.sessionId); await controller.confirm();
  const entry = controller.getSnapshot().overview?.trash[0]; assert.ok(entry);
  const directory = join(f.store.root, 'trash', entry.id);
  f.adapter.busy.add(group.sessionId);
  controller.setTab('trash'); controller.toggle(entry.id); await controller.preview('purge'); await controller.confirm();
  assert.equal(controller.getSnapshot().result?.items[0]?.status, 'failed');
  assert.equal(controller.getSnapshot().result?.items[0]?.code, 'busy');
  assert.equal(controller.getSnapshot().result?.counts.pending, 0);
  assert.equal(controller.getSnapshot().overview?.trash[0]?.id, entry.id);
  assert.equal(await present(join(directory, '0', 'session.v4.jsonl')), true);
  assert.equal(f.adapter.locks, 0);
});

test('reviewing a pending row cancels its old durable request and opens fresh consent without executing a move', async t => {
  const f = await fixture();
  let controller: ArchiveClientController | undefined;
  t.after(async () => { controller?.dispose(); await f.service.close(); await f.close(); });
  const group = await f.add('pending-review', ['pending-child']); await f.add('other');
  f.adapter.loaded.add(group.sessionId);
  const oldPreview = await f.service.preview('trash', [group.sessionId]); const oldRequest = randomUUID();
  assert.equal((await f.service.execute(oldPreview.id, oldRequest)).items[0]?.status, 'pending');
  const calls: string[] = []; let executes = 0;
  controller = new ArchiveClientController({
    list: () => f.service.list(),
    preview: (action, ids) => { calls.push(`preview:${action}:${ids.join(',')}`); return f.service.preview(action, ids); },
    execute: (previewId, requestId) => { executes++; return f.service.execute(previewId, requestId); },
    cancelPending: (ids, requestId) => { calls.push(`cancel:${ids.join(',')}`); return f.service.cancelPending(ids, requestId); },
  });
  await controller.open(); controller.toggle('other');
  await controller.reviewPending(group.sessionId);
  assert.deepEqual(calls, ['cancel:pending-review', 'preview:trash:pending-review']);
  assert.equal(executes, 0);
  assert.equal(controller.getSnapshot().preview?.action, 'trash');
  assert.deepEqual(controller.getSnapshot().selected, [group.sessionId]);
  const after = await f.service.list();
  assert.equal(after.recentResults.find(item => item.operationId === oldRequest)?.items[0]?.status, 'cancelled');
  assert.equal(after.archived.find(item => item.id === group.sessionId)?.pending, undefined);
  assert.equal((await f.store.operations()).length, 0);
  assert.deepEqual(after.trash, []);
  for (const member of group.members) assert.equal(await present(member.directory), true);
  controller.dismissPreview();
  assert.equal((await f.store.operations()).length, 0, 'Backing out does not resurrect the old queued request.');
});

test('closing or reopening during pending cancellation cannot resurrect its review preview', async () => {
  for (const reopen of [false, true]) {
    const current = overview(); const pending = deferred<BatchResult>(); let previews = 0;
    const controller = new ArchiveClientController(api({
      list: async () => structuredClone(current), cancelPending: () => pending.promise,
      preview: async action => { previews++; return preview(action); },
    }));
    await controller.open();
    const reviewing = controller.reviewPending('pending-c');
    controller.close(); if (reopen) await controller.open();
    current.archived = current.archived.map(item => item.id === 'pending-c' ? { ...item, pending: false } : item);
    pending.resolve(cancelled()); await reviewing;
    assert.equal(previews, 0);
    assert.equal(controller.getSnapshot().open, reopen);
    assert.equal(controller.getSnapshot().preview, null);
    assert.deepEqual(controller.getSnapshot().selected, []);
    controller.dispose();
  }
});

test('an uncertain pending cancellation retries the same request before offering fresh consent', async () => {
  const current = overview(); const cancellations: Array<[string[], string]> = []; const previews: string[][] = []; let executes = 0;
  const controller = new ArchiveClientController(api({
    list: async () => structuredClone(current),
    cancelPending: async (ids, requestId) => {
      cancellations.push([ids, requestId]);
      if (cancellations.length === 1) throw new ClientTransportError('cancel response lost');
      current.archived = current.archived.map(item => item.id === 'pending-c' ? { ...item, pending: false } : item);
      return cancelled('pending-c', requestId);
    },
    preview: async (action, ids) => { previews.push(ids); return preview(action); },
    execute: async () => { executes++; return result(); },
  }), () => 'same-cancel-request');
  await controller.open(); await controller.reviewPending('pending-c');
  assert.equal(controller.getSnapshot().uncertainRequest, true);
  assert.equal(controller.getSnapshot().preview, null);
  assert.deepEqual(previews, []);
  await controller.reviewPending('pending-c'); assert.equal(cancellations.length, 1);
  await controller.retryUncertain();
  assert.deepEqual(cancellations, [[['pending-c'], 'same-cancel-request'], [['pending-c'], 'same-cancel-request']]);
  assert.deepEqual(previews, [['pending-c']]);
  assert.equal(controller.getSnapshot().uncertainRequest, false);
  assert.equal(controller.getSnapshot().preview?.action, 'trash');
  assert.equal(executes, 0);
  controller.dispose();
});

test('pending review stops on an unsuccessful cancellation, failed refresh, remaining wait, or vanished record', async () => {
  for (const mode of ['skipped', 'failed', 'refresh-failed', 'still-pending', 'disappeared']) {
    const current = overview(); let listed = 0; let previews = 0;
    const controller = new ArchiveClientController(api({
      list: async () => { if (++listed > 1 && mode === 'refresh-failed') throw new Error('refresh unavailable'); return structuredClone(current); },
      cancelPending: async () => {
        if (mode === 'disappeared') current.archived = current.archived.filter(item => item.id !== 'pending-c');
        if (mode === 'skipped' || mode === 'failed') return { ...cancelled(), items: [{ id: 'pending-c', title: '', status: mode }],
          counts: { succeeded: 0, pending: 0, skipped: mode === 'skipped' ? 1 : 0, failed: mode === 'failed' ? 1 : 0 } };
        return cancelled();
      },
      preview: async action => { previews++; return preview(action); },
    }));
    await controller.open(); await controller.reviewPending('pending-c');
    assert.equal(previews, 0, mode); assert.equal(controller.getSnapshot().preview, null, mode);
    assert.deepEqual(controller.getSnapshot().selected, [], mode);
    controller.dispose();
  }
});

test('pending review admits only a visible row and places its sole refreshed selection on the correct page', async () => {
  const current = overview();
  current.archived = Array.from({ length: 100 }, (_, i) => ({ id: `cold-${i}`, title: `Cold ${i}`, workspace: 'QA', sizeBytes: 1, descendantCount: 0 }));
  current.archived.splice(2, 0, { id: 'visible-pending', title: 'Visible pending', workspace: 'QA', sizeBytes: 1, descendantCount: 0, pending: true });
  current.archived.push({ id: 'hidden-pending', title: 'Hidden pending', workspace: 'QA', sizeBytes: 1, descendantCount: 0, pending: true });
  const cancellations: string[][] = [];
  const controller = new ArchiveClientController(api({
    list: async () => structuredClone(current),
    cancelPending: async (ids, requestId) => {
      cancellations.push(ids); const item = current.archived.find(item => item.id === ids[0])!;
      current.archived = [...current.archived.filter(row => row.id !== item.id), { ...item, pending: false }];
      return cancelled(item.id, requestId);
    },
    preview: async (action, ids) => ({ ...preview(action), items: [{ ...preview(action).items[0]!, id: ids[0]!, sessionId: ids[0]! }] }),
  }));
  await controller.open(); controller.toggle('cold-0');
  await controller.reviewPending('hidden-pending'); assert.deepEqual(cancellations, []);
  await controller.reviewPending('visible-pending');
  assert.deepEqual(cancellations, [['visible-pending']]);
  assert.equal(controller.getSnapshot().page, 1);
  assert.deepEqual(controller.getSnapshot().selected, ['visible-pending']);
  assert.deepEqual(visibleSelection(controller.getSnapshot()), ['visible-pending']);
  controller.dispose();
});

test('pages limit select-all and mutation targets to 100 and never retain hidden selections', async () => {
  const current = overview();
  current.archived = Array.from({ length: 205 }, (_, i) => ({ id: `archive-${i}`, title: `Conversation ${i}`, workspace: 'QA', sizeBytes: 10, descendantCount: 0 }));
  const requests: string[][] = [];
  const controller = new ArchiveClientController(api({ list: async () => current, preview: async (_action, ids) => { requests.push(ids); return preview(); } }));
  await controller.open();
  assert.equal(PAGE_SIZE, 100);
  assert.equal(pageCount(controller.getSnapshot()), 3);
  controller.selectAll(true);
  assert.equal(controller.getSnapshot().selected.length, 100);
  controller.toggle('archive-100');
  assert.equal(controller.getSnapshot().selected.length, 100);
  await controller.preview('trash');
  assert.equal(requests[0]?.length, 100);
  controller.dismissPreview();
  controller.setPage(1);
  assert.deepEqual(controller.getSnapshot().selected, []);
  controller.selectAll(true);
  assert.equal(controller.getSnapshot().selected[0], 'archive-100');
  assert.equal(controller.getSnapshot().selected.at(-1), 'archive-199');
  controller.setPage(2);
  controller.selectAll(true);
  assert.equal(controller.getSnapshot().selected.length, 5);
  controller.setTab('trash');
  assert.equal(controller.getSnapshot().page, 0);
  assert.deepEqual(controller.getSnapshot().selected, []);
});

test('refresh clamps a removed page and native menu opens a target beyond the first page', async () => {
  const current = overview();
  current.archived = Array.from({ length: 150 }, (_, i) => ({ id: `archive-${i}`, title: `Conversation ${i}`, workspace: 'QA', sizeBytes: 10, descendantCount: 0 }));
  const requests: string[][] = [];
  const controller = new ArchiveClientController(api({ list: async () => current, preview: async (_action, ids) => { requests.push(ids); return preview(); } }));
  await controller.open('archive-125');
  assert.equal(controller.getSnapshot().page, 1);
  assert.deepEqual(requests, [['archive-125']]);
  controller.dismissPreview();
  controller.selectAll(true);
  current.archived = current.archived.slice(0, 50);
  await controller.refresh();
  assert.equal(controller.getSnapshot().page, 0);
  assert.deepEqual(controller.getSnapshot().selected, []);
});

test('refresh prunes targets that disappeared rather than retaining hidden selections', async () => {
  const current = overview();
  const controller = new ArchiveClientController(api({ list: async () => current }));
  await controller.open();
  controller.selectAll(true);
  current.archived = current.archived.filter((item) => item.id === 'archive-b');
  await controller.refresh();
  assert.deepEqual(controller.getSnapshot().selected, ['archive-b']);
});

test('late list responses cannot replace a newer observation', async () => {
  const first = deferred<Overview>();
  let calls = 0;
  const current = overview();
  const controller = new ArchiveClientController(api({ list: () => ++calls === 1 ? first.promise : Promise.resolve(current) }));
  const opening = controller.open();
  await controller.refresh();
  first.resolve({ ...overview(), archived: [] });
  await opening;
  assert.equal(controller.getSnapshot().overview?.archived.length, 3);
});

test('closing an in-flight preview prevents it from reopening a confirmation', async () => {
  const pending = deferred<Preview>();
  const controller = new ArchiveClientController(api({ preview: () => pending.promise }));
  await controller.open();
  controller.toggle('archive-a');
  const loading = controller.preview('trash');
  controller.close();
  pending.resolve(preview());
  await loading;
  assert.equal(controller.getSnapshot().open, false);
  assert.equal(controller.getSnapshot().preview, null);
  assert.equal(controller.getSnapshot().loading, false);
});

test('opening from a native menu previews the selected session without executing it', async () => {
  const requests: string[][] = [];
  let executeCount = 0;
  const controller = new ArchiveClientController(api({
    preview: async (_action, ids) => { requests.push(ids); return preview(); },
    execute: async () => { executeCount++; return result(); },
  }));
  await controller.open('archive-a');
  assert.deepEqual(requests, [['archive-a']]);
  assert.equal(controller.getSnapshot().preview?.id, 'preview-trash');
  assert.equal(executeCount, 0);
  controller.dismissPreview();
  assert.equal(executeCount, 0);
});

test('expired and all-blocked previews cannot start a mutation', async () => {
  let executeCount = 0;
  const controller = new ArchiveClientController(api({ execute: async () => { executeCount++; return result(); } }), () => 'request-1', () => 30_000);
  await controller.open('archive-a');
  await controller.confirm();
  assert.equal(controller.getSnapshot().error?.code, 'preview-expired');
  assert.equal(executeCount, 0);
  assert.equal(canExecutePreview({ ...preview(), items: [{ ...preview().items[0]!, disposition: 'blocked' }] }, 100), false);
});

test('uncertain execution retries the exact request instead of making a second operation', async () => {
  const requests: Array<[string, string]> = [];
  const controller = new ArchiveClientController(api({
    execute: async (previewId, requestId) => {
      requests.push([previewId, requestId]);
      if (requests.length === 1) throw new ClientTransportError('connection closed');
      return result(requestId);
    },
  }), () => 'request-unique', () => 100);
  await controller.open('archive-a');
  await controller.confirm();
  assert.equal(controller.getSnapshot().uncertainRequest, true);
  controller.close();
  await controller.open();
  controller.selectAll(true);
  assert.deepEqual(controller.getSnapshot().selected, []);
  await controller.retryUncertain();
  assert.deepEqual(requests, [['preview-trash', 'request-unique'], ['preview-trash', 'request-unique']]);
  assert.equal(controller.getSnapshot().uncertainRequest, false);
  assert.equal(controller.getSnapshot().result?.counts.succeeded, 1);
});

test('refresh reconciles an unknown response with the host receipt', async () => {
  const current = overview();
  const controller = new ArchiveClientController(api({
    list: async () => current,
    execute: async () => { throw new ClientTransportError('response lost'); },
  }), () => 'known-request', () => 100);
  await controller.open('archive-a');
  await controller.confirm();
  current.recentResults = [result('known-request')];
  await controller.refresh();
  assert.equal(controller.getSnapshot().uncertainRequest, false);
  assert.equal(controller.getSnapshot().result?.operationId, 'known-request');
});

test('a known host rejection stays retryable through a fresh confirmation', async () => {
  const controller = new ArchiveClientController(api({ execute: async () => { throw new ArchiveError('stale-preview', 'Target changed.'); } }), () => 'request-1', () => 100);
  await controller.open('archive-a');
  await controller.confirm();
  assert.equal(controller.getSnapshot().uncertainRequest, false);
  assert.equal(controller.getSnapshot().error?.code, 'stale-preview');
  assert.equal(controller.getSnapshot().result, null);
});

test('a mutation finishes and retains its result after the dialog is closed', async () => {
  const pending = deferred<BatchResult>();
  const controller = new ArchiveClientController(api({ execute: () => pending.promise }), () => 'request-1', () => 100);
  await controller.open('archive-a');
  const executing = controller.confirm();
  controller.close();
  pending.resolve(result());
  await executing;
  assert.equal(controller.getSnapshot().open, false);
  assert.equal(controller.getSnapshot().busy, false);
  assert.equal(controller.getSnapshot().result?.items[0]?.status, 'moved');
});

test('a persisted failed result can be reviewed and retried after reopening the client', async () => {
  const current = overview();
  current.recentResults = [{ ...result(), items: [{ id: 'archive-a', title: '', status: 'failed' }], counts: { succeeded: 0, pending: 0, skipped: 0, failed: 1 } }];
  const requests: Array<[string, string[]]> = [];
  const controller = new ArchiveClientController(api({
    list: async () => current,
    preview: async (action, ids) => { requests.push([action, ids]); return preview(action); },
  }));
  await controller.open();
  assert.equal(controller.getSnapshot().result, null);
  assert.equal(controller.getSnapshot().overview?.recentResults[0]?.items[0]?.title, 'A');
  await controller.retryItem('archive-a');
  assert.deepEqual(requests, [['trash', ['archive-a']]]);
  assert.equal(controller.getSnapshot().preview?.id, 'preview-trash');
});

test('redacted completion receipts retain preview titles only in client memory', async () => {
  const redacted = { ...result(), items: [{ ...result().items[0]!, title: '' }] };
  const controller = new ArchiveClientController(api({ execute: async () => redacted }), () => 'request-1', () => 100);
  await controller.open('archive-a');
  await controller.confirm();
  assert.equal(controller.getSnapshot().result?.items[0]?.title, 'A');
  assert.equal(redacted.items[0]?.title, '');
});
