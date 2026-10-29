import { ArchiveError, type ArchiveApi, type StorageOverview, type StorageWorkspace } from './contracts.js';
import { scanStorage, type UsageRoot, type UsageScanOptions, type UsageScanResult } from './storage-usage.js';

export interface StorageSourceResolver {
  workspaces(): StorageWorkspace[];
  sources(workspaceId?: string): Promise<UsageRoot[]>;
}
interface InspectorOptions {
  /** Tests may observe scheduling without changing production scan budgets. */
  scan?: (roots: UsageRoot[], options: UsageScanOptions) => Promise<UsageScanResult>;
}
/** Read-only scans have their own lifetime, independent of archive mutations. */
export class StorageInspector {
  private active: { controller: AbortController; done: Promise<StorageOverview> } | undefined;
  private closed = false;
  constructor(private readonly resolver: StorageSourceResolver, private readonly options: InspectorOptions = {}) {}
  workspaces(): StorageWorkspace[] {
    try { return this.resolver.workspaces(); } catch { return []; }
  }
  scan(workspaceId?: string, signal?: AbortSignal): Promise<StorageOverview> {
    if (this.closed) return Promise.reject(new ArchiveError('scan-closed', 'Storage inspection is closed. Reload the plugin and try again.'));
    if (this.active) return Promise.reject(new ArchiveError('scan-busy', 'A storage scan is already running. Wait for it to finish or cancel it.'));
    const controller = new AbortController();
    const cancel = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', cancel, { once: true });
    const checkCancelled = () => {
      if (controller.signal.aborted) throw new ArchiveError('scan-cancelled', 'The storage scan was cancelled.');
    };
    const done = (async (): Promise<StorageOverview> => {
      checkCancelled();
      const roots = await this.resolver.sources(workspaceId);
      checkCancelled();
      const usage = await (this.options.scan ?? scanStorage)(roots, { signal: controller.signal, maxDurationMs: 5_000, maxEntries: 50_000 });
      checkCancelled();
      if (workspaceId !== undefined) {
        let current: UsageRoot[];
        try { current = await this.resolver.sources(workspaceId); }
        catch { throw new ArchiveError('workspace-changed', 'The selected workspace changed. Select it again and rescan.'); }
        checkCancelled();
        if (roots.length !== 1 || current.length !== 1 || roots[0]?.id !== current[0]?.id || roots[0]?.path !== current[0]?.path
          || JSON.stringify(roots[0]?.excludePaths ?? []) !== JSON.stringify(current[0]?.excludePaths ?? []))
          throw new ArchiveError('workspace-changed', 'The selected workspace changed. Select it again and rescan.');
      }
      return { ...usage, scope: workspaceId === undefined ? 'host' : 'workspace', workspaces: this.workspaces(),
        ...(workspaceId === undefined ? {} : { workspaceId }) };
    })();
    this.active = { controller, done };
    // Both settlement paths release the listener and admission slot. Avoid an
    // unhandled finally() branch when the caller is already awaiting rejection.
    const finish = () => {
      signal?.removeEventListener('abort', cancel);
      if (this.active?.done === done) this.active = undefined;
    };
    void done.then(finish, finish);
    return done;
  }
  async close(): Promise<void> {
    this.closed = true;
    const active = this.active;
    if (!active) return;
    active.controller.abort();
    await active.done.catch(() => {});
  }
}

/** Preserve the archive class receiver; never replace or wrap a host service. */
export function wrapArchiveApi(api: ArchiveApi, inspector: StorageInspector): ArchiveApi {
  return {
    list: async () => ({ ...await api.list(), storageWorkspaces: inspector.workspaces() }),
    preview: (action, ids) => api.preview(action, ids),
    execute: (previewId, requestId) => api.execute(previewId, requestId),
    cancelPending: (ids, requestId) => api.cancelPending(ids, requestId),
    storage: (workspaceId, signal) => inspector.scan(workspaceId, signal),
  };
}
