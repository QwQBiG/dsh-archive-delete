import { ArchiveError, PACKAGE_NAME, type ArchiveApi, type DshAdapter, type Lease, type SupportStatus } from './contracts.js';
import { acquirePluginLease, createDshAdapter, getHostPaths, getNativeLockExclusive, type HostContext } from './dsh-adapter.js';
import { registerHostRoutes } from './host-routes.js';
import { ArchiveService } from './service.js';
import { TrashStore } from './storage.js';

export const name = 'dsh-archive-delete';
export const inject = ['connection', 'workspaceRegistry', 'sessionPersistence', 'sessions', 'sessionProjectionCache', 'sessionProjections', 'profileContext', 'dshHomePath'];

function unavailableApi(status: SupportStatus): ArchiveApi {
  const reject = async (): Promise<never> => { throw new ArchiveError('unsupported-host', status.reason ?? 'The archive plugin is unavailable.'); };
  return { list: async () => ({ support: status, archived: [], trash: [], recentResults: [] }), preview: reject, execute: reject, cancelPending: reject };
}
/** Load without replacing any native service. Startup failures leave a readable, disabled UI. */
export async function apply(ctx: HostContext): Promise<() => Promise<void>> {
  let api: ArchiveApi;
  let lease: Lease | undefined;
  let archive: ArchiveService | undefined;
  try {
    const adapter: DshAdapter = await createDshAdapter(ctx);
    const support = await adapter.capabilities();
    if (!support.supported) api = unavailableApi(support);
    else {
      const paths = await getHostPaths(ctx);
      const store = new TrashStore({ root: paths.root, sessionsRoot: paths.sessionsRoot });
      await store.initialize();
      lease = await acquirePluginLease(paths.root, getNativeLockExclusive(ctx));
      archive = new ArchiveService(adapter, store);
      await archive.initialize();
      api = archive;
    }
  } catch (error) {
    await archive?.close();
    await lease?.release();
    lease = undefined;
    ctx.logger?.warn(`${PACKAGE_NAME}: initialization failed; archive operations are disabled. ${error instanceof Error ? error.message : String(error)}`);
    api = unavailableApi({ supported: false, version: 'unknown', platform: process.platform,
      reason: error instanceof ArchiveError && error.code === 'store-busy' ? error.message : 'Archive storage could not be initialized. Check the host diagnostics, then reload the plugin.' });
  }
  try {
    const unmount = registerHostRoutes(ctx, api);
    return async () => { unmount(); await archive?.close(); await lease?.release(); };
  }
  catch (error) {
    await archive?.close();
    await lease?.release();
    ctx.logger?.warn(`${PACKAGE_NAME}: the authenticated API could not be registered. ${error instanceof Error ? error.message : String(error)}`);
    return async () => {};
  }
}
