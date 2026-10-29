import assert from 'node:assert/strict';
import test from 'node:test';
import { join, resolve } from 'node:path';
import { createDshAdapter, type HostContext } from '../src/dsh-adapter.js';
import type { DshAdapter, JsonObject, SessionGroup, SessionMember } from '../src/contracts.js';

async function fixture(ids = ['parent']) {
  const home = resolve('synthetic-hot-release-home');
  const effect = Symbol('native-effect-test');
  const sessions = new Map<string, { header: JsonObject }>();
  const agents = new Map<string, any>();
  const owners = new Map<string, any>();
  const disposed: string[] = []; const flushed: string[] = [];
  const activities = new Map<string, unknown[]>();
  const disposables = new Set<() => unknown>();
  const fiber = { _disposables: disposables };
  let archived = true;
  let onFlush: (() => void | Promise<void>) | undefined;
  const members: SessionMember[] = ids.map((id, index) => {
    const header: JsonObject = { id, version: 4, createdAt: 1000, ...(index ? { parentSession: ids[0]!, origin: 'subagent' } : {}) };
    const session = { header }; sessions.set(id, session);
    const agent = { id, session, status: 'idle', phase: { kind: 'idle' }, inbox: { hasPending: false } }; agents.set(id, agent);
    const dispose = Object.assign(() => { disposed.push(id); sessions.delete(id); agents.delete(id); disposables.delete(dispose); }, { [effect]: { label: 'agentLoop.lifecycle(' + id + ')' } });
    disposables.add(dispose);
    return { id, header, title: id, directory: join(home, 'sessions', '--project--', id), revision: 'original', archived: index === 0,
      pinned: false, loaded: true, activity: [], sizeBytes: 1 };
  });
  const registry = { get archivedSessionIds() { return archived ? [ids[0]!] : []; }, requireState: () => ({ workspaceIds: [] }), requireTable: () => ({}),
    enqueueOperation: async (job: () => Promise<unknown>) => job(), setState: async () => {}, indexHeader: async () => {},
    headers: new Map(), sessionPaths: new Map(), missingSessionPaths: new Set(), invalidSessionPaths: new Map() };
  const ctx: HostContext = {
    fiber, registry: { values: () => [{ fibers: new Set([fiber]) }].values() },
    sessions: { get: (id: string) => sessions.get(id), flush: async (session: { header: JsonObject }) => { flushed.push(String(session.header.id)); await onFlush?.(); return true; } },
    sessionPersistence: { name: 'session-persistence-jsonl', root: join(home, 'sessions'), list: async () => [], stat: async () => undefined, open: async () => {}, locate: () => undefined },
    workspaceRegistry: registry, sessionProjectionCache: { cachedSnapshot: () => undefined, requireTable: () => ({}), put: async () => {} },
    sessionProjections: { restore: () => ({}) },
    waterfall: async (_event, request) => activities.get(request.sessionId) ?? [], emit: () => {},
  };
  const loop = { runtime: { ctx } }; ctx.agentLoop = loop;
  ctx.agents = { get: (id: string) => agents.get(id), list: () => [...agents.values()], isOwnedBy: (id: string, parent: unknown) => owners.get(id) === parent,
    requireFactory: () => ({ target: loop }) };
  const adapter = await createDshAdapter(ctx, { home, version: '0.2.1-rc.3', platform: 'darwin', effectSymbol: effect }) as DshAdapter & { releaseIdle(group: SessionGroup): Promise<boolean> };
  const group: SessionGroup = { sessionId: ids[0]!, title: ids[0]!, sessionsRoot: join(home, 'sessions'), members };
  return { adapter, group, agents, sessions, activities, owners, disposables, disposed, flushed, effect,
    setFlush: (value: typeof onFlush) => { onFlush = value; }, unarchive: () => { archived = false; } };
}

test('hot release claims native owner effects leaf-first and preserves the archive registration', async () => {
  const f = await fixture(['parent', 'child']); f.owners.set('child', f.agents.get('parent'));
  assert.equal(await f.adapter.releaseIdle(f.group), true);
  assert.deepEqual(f.disposed, ['child', 'parent']);
  assert.equal(f.sessions.size, 0); assert.equal(f.agents.size, 0);
  assert.equal(f.flushed.length, 2);
});

test('hot release rejects running work, maintenance, and queued input before any disposer is called', async () => {
  for (const change of [
    (f: Awaited<ReturnType<typeof fixture>>) => { f.agents.get('parent').status = 'running'; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.agents.get('parent').phase.kind = 'maintenance'; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.agents.get('parent').inbox.hasPending = true; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.activities.set('parent', [{ kind: 'schedule' }]); },
  ]) {
    const f = await fixture(); change(f);
    await assert.rejects(f.adapter.releaseIdle(f.group), { code: 'active' });
    assert.deepEqual(f.disposed, []); assert.equal(f.sessions.size, 1);
  }
});

test('hot release protects runtime-owned children outside the confirmed durable group', async () => {
  const f = await fixture(); const parent = f.agents.get('parent');
  f.agents.set('independent-fork', { id: 'independent-fork' }); f.owners.set('independent-fork', parent);
  await assert.rejects(f.adapter.releaseIdle(f.group), { code: 'ambiguous-lineage' });
  assert.deepEqual(f.disposed, []); assert.deepEqual(f.flushed, []);
});

test('hot release refuses missing or duplicate owner capabilities and does not mutate host maps', async () => {
  const missing = await fixture(['parent', 'child']);
  for (const dispose of missing.disposables) if ((dispose as unknown as Record<symbol, { label: string }>)[missing.effect]!.label.includes('child')) missing.disposables.delete(dispose);
  assert.equal(await missing.adapter.releaseIdle(missing.group), false);
  assert.deepEqual(missing.disposed, []); assert.equal(missing.sessions.size, 2);
  const duplicate = await fixture();
  duplicate.disposables.add(Object.assign(() => {}, { [duplicate.effect]: { label: 'agentLoop.lifecycle(parent)' } }));
  await assert.rejects(duplicate.adapter.releaseIdle(duplicate.group), { code: 'ambiguous-lifecycle' });
  assert.deepEqual(duplicate.disposed, []); assert.deepEqual(duplicate.flushed, []);
});

test('hot release rechecks activity and identity after awaited flushes before claiming the whole group', async () => {
  const changed = await fixture(['parent', 'child']);
  changed.setFlush(() => { changed.agents.get('child').phase.kind = 'maintenance'; });
  await assert.rejects(changed.adapter.releaseIdle(changed.group), { code: 'active' });
  assert.deepEqual(changed.disposed, []);
  const unarchived = await fixture(); unarchived.setFlush(() => unarchived.unarchive());
  await assert.rejects(unarchived.adapter.releaseIdle(unarchived.group), { code: 'not-archived' });
  assert.deepEqual(unarchived.disposed, []);
  const failure = await fixture(); failure.setFlush(() => { throw new Error('synthetic flush failed'); });
  await assert.rejects(failure.adapter.releaseIdle(failure.group), /synthetic flush failed/);
  assert.deepEqual(failure.disposed, []); assert.equal(failure.sessions.size, 1);
});
