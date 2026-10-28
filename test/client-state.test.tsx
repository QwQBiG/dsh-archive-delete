import test from 'node:test';
import assert from 'node:assert/strict';
import { ArchiveClientController, ClientTransportError, canExecutePreview, visibleSelection } from '../src/client-state.js';
import { ArchiveError, type ArchiveApi, type BatchResult, type Overview, type Preview } from '../src/contracts.js';

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
