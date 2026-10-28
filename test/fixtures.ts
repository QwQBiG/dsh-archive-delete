import { mkdtemp, mkdir, writeFile, readFile, realpath, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ArchiveError, type DshAdapter, type SessionGroup, type LeaseResult, type SupportStatus, type ArchivedSession } from '../src/contracts.js';
import { TrashStore } from '../src/storage.js';
import { ArchiveService } from '../src/service.js';

export class FixtureAdapter implements DshAdapter {
  readonly groups = new Map<string, SessionGroup>();
  readonly archived = new Set<string>();
  readonly loaded = new Set<string>();
  readonly busy = new Set<string>();
  readonly active = new Set<string>();
  failRemove = false;
  failRestore = false;
  supported = true;
  locks = 0;
  async capabilities(): Promise<SupportStatus> { return { supported: this.supported, version: '0.2.1-rc.3', platform: 'darwin', reason: 'Synthetic unsupported fixture' }; }
  async listArchived(): Promise<ArchivedSession[]> {
    return [...this.groups.values()].filter(g => this.archived.has(g.sessionId)).map(g => ({ id: g.sessionId, title: g.title,
      workspace: 'Test project', sizeBytes: g.members.reduce((n, m) => n + m.sizeBytes, 0), descendantCount: g.members.length - 1 }));
  }
  async inspect(sessionId: string): Promise<SessionGroup> {
    const template = this.groups.get(sessionId);
    if (!template) throw new ArchiveError('missing-session', 'Synthetic source is missing.');
    const group = structuredClone(template);
    for (const member of group.members) {
      let body: string;
      try { body = await readFile(join(member.directory, 'session.v4.jsonl'), 'utf8'); }
      catch { throw new ArchiveError('missing-session', 'Synthetic source is missing.'); }
      member.revision = createHash('sha256').update(body).digest('hex');
      member.loaded = this.loaded.has(member.id); member.archived = this.archived.has(member.id);
      member.activity = this.active.has(member.id) ? [{ kind: 'turn', label: 'Synthetic active turn' }] : [];
    }
    return group;
  }
  async acquire(group: SessionGroup): Promise<LeaseResult> {
    if (group.members.some(m => this.busy.has(m.id))) return { kind: 'busy', message: 'External writer' };
    if (group.members.some(m => this.loaded.has(m.id))) return { kind: 'loaded', message: 'Host-owned writer' };
    this.locks++; return { kind: 'acquired', lease: { release: async () => { this.locks--; } } };
  }
  async acquireLocated(group: SessionGroup, _directories: (string | undefined)[]): Promise<LeaseResult> { return this.acquire(group); }
  async removeRegistry(group: SessionGroup): Promise<void> {
    if (this.failRemove) { this.failRemove = false; throw new Error('Synthetic metadata failure'); }
    group.members.forEach(m => this.archived.delete(m.id));
  }
  async restoreRegistry(group: SessionGroup): Promise<void> {
    if (this.failRestore) { this.failRestore = false; throw new Error('Synthetic restore failure'); }
    group.members.forEach(m => { if (m.archived) this.archived.add(m.id); else this.archived.delete(m.id); });
  }
}
export async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-archive-delete-test-')));
  const sessions = join(root, 'sessions'); await mkdir(sessions); await mkdir(join(sessions, 'project'));
  const adapter = new FixtureAdapter();
  const store = new TrashStore({ root: join(root, 'plugin'), sessionsRoot: sessions });
  const service = new ArchiveService(adapter, store); await service.initialize();
  async function add(sessionId: string, children: string[] = []) {
    const members = [];
    for (const [i, key] of [sessionId, ...children].entries()) {
      const directory = join(sessions, 'project', key); await mkdir(directory);
      const header = { id: key, cwd: '/synthetic/project', createdAt: 1, ...(i ? { origin: 'subagent', parentSession: sessionId } : {}) };
      const body = `${JSON.stringify(header)}\n${JSON.stringify({ type: 'user/message', data: { content: 'Synthetic test data' } })}\n`;
      await writeFile(join(directory, 'session.v4.jsonl'), body);
      members.push({ id: key, title: `Test ${key}`, directory, revision: '', header,
        workspaceId: 'workspace', workspacePath: '/synthetic/project', accountIndex: i,
        archived: i === 0, pinned: false, loaded: false, activity: [], sizeBytes: Buffer.byteLength(body) });
      if (i === 0) adapter.archived.add(key);
    }
    const group: SessionGroup = { sessionId, title: `Test ${sessionId}`, sessionsRoot: sessions, members };
    adapter.groups.set(sessionId, group); return group;
  }
  return { root, sessions, adapter, store, service, add, close: () => rm(root, { recursive: true, force: true }) };
}
export async function present(path: string): Promise<boolean> { try { await lstat(path); return true; } catch { return false; } }
