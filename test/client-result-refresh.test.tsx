import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { ArchiveClientController } from '../src/client-state.js';
import { ArchiveService } from '../src/service.js';
import type { ArchiveApi, Overview } from '../src/contracts.js';
import { fixture } from './fixtures.js';

for (const transition of ['cancelled', 'moved', 'changed'] as const) {
  test(`refresh reconciles a displayed pending receipt after it becomes ${transition}`, async t => {
    const f = await fixture(); t.after(f.close);
    const group = await f.add(`receipt-${transition}`); f.adapter.loaded.add(group.sessionId);
    const controller = new ArchiveClientController(f.service); t.after(() => controller.dispose());
    await controller.open(group.sessionId); await controller.confirm();
    const original = controller.getSnapshot().result!;
    assert.equal(original.items[0]!.status, 'pending');
    if (transition === 'cancelled') await f.service.cancelPending([group.sessionId], randomUUID());
    else {
      if (transition === 'changed') await appendFile(join(group.members[0]!.directory, 'session.v4.jsonl'), '\n');
      f.adapter.loaded.clear(); const restarted = new ArchiveService(f.adapter, f.store); await restarted.initialize();
    }
    await controller.refresh();
    const displayed = controller.getSnapshot().result!;
    const durable = controller.getSnapshot().overview!.recentResults.find(result => result.operationId === original.operationId)!;
    assert.equal(displayed.operationId, original.operationId);
    assert.equal(displayed.items[0]!.status, transition === 'changed' ? 'failed' : transition);
    assert.deepEqual(displayed.counts, durable.counts);
    assert.equal(displayed.items[0]!.title, group.title, 'redacted receipts keep this client\'s remembered title');
    if (transition === 'changed') assert.equal(displayed.items[0]!.code, 'source-changed');
  });
}

test('refresh retains the local result when only unrelated or no recent receipts are returned', async t => {
  const f = await fixture(); t.after(f.close); const group = await f.add('local-receipt'); f.adapter.loaded.add(group.sessionId);
  let visible: Overview['recentResults'] | undefined;
  const api: ArchiveApi = { list: async () => { const value = await f.service.list(); return visible ? { ...value, recentResults: visible } : value; },
    preview: (action, ids) => f.service.preview(action, ids), execute: (preview, request) => f.service.execute(preview, request),
    cancelPending: (ids, request) => f.service.cancelPending(ids, request) };
  const controller = new ArchiveClientController(api); t.after(() => controller.dispose());
  await controller.open(group.sessionId); await controller.confirm(); const original = controller.getSnapshot().result;
  const other = await f.service.cancelPending(['unrelated'], randomUUID()); visible = [other];
  await controller.refresh(); assert.equal(controller.getSnapshot().result, original);
  visible = []; await controller.refresh(); assert.equal(controller.getSnapshot().result, original);
});
