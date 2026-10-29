import { ArchiveError, type Action, type ArchiveApi, type BatchResult, type Overview, type Preview, type StorageOverview } from './contracts.js';

export type ArchiveTab = 'archived' | 'trash' | 'storage';
export type ArchiveSort = 'default' | 'size-desc';
export const PAGE_SIZE = 100;
export interface ClientError { code: string; message: string; uncertain: boolean }
export interface StorageClientState {
  workspaceId: string;
  scanning: boolean;
  result: StorageOverview | null;
  error: ClientError | null;
  cancelled: boolean;
}
export interface ClientState {
  open: boolean;
  tab: ArchiveTab;
  page: number;
  sort: ArchiveSort;
  overview: Overview | null;
  selected: readonly string[];
  loading: boolean;
  busy: boolean;
  preview: Preview | null;
  result: BatchResult | null;
  error: ClientError | null;
  uncertainRequest: boolean;
  maintenance?: boolean;
  storage: StorageClientState;
}

export class ClientTransportError extends Error {
  constructor(message: string) { super(message); this.name = 'ClientTransportError'; }
}

type Mutation =
  | { kind: 'execute'; previewId: string; requestId: string }
  | { kind: 'cancel'; ids: string[]; requestId: string; review?: { id: string; openGeneration: number } };

/** IDs currently eligible for selection; pending entries have a dedicated cancel action. */
export function pageItems<T>(items: readonly T[], page: number): readonly T[] { return items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE); }
export function sortedItems<T extends { sizeBytes: number }>(items: readonly T[], sort: ArchiveSort): readonly T[] {
  return sort === 'size-desc' ? items.toSorted((a, b) => b.sizeBytes - a.sizeBytes) : items;
}
export function pageCount(state: Pick<ClientState, 'tab' | 'overview'>): number { return state.tab === 'storage' ? 1 : Math.max(1, Math.ceil((state.overview?.[state.tab].length ?? 0) / PAGE_SIZE)); }
export function selectableIds(state: Pick<ClientState, 'tab' | 'overview' | 'page' | 'sort'>): string[] {
  if (!state.overview || state.tab === 'storage') return [];
  return state.tab === 'archived'
    ? pageItems(sortedItems(state.overview.archived, state.sort), state.page).filter((item) => !item.pending).map((item) => item.id)
    : pageItems(sortedItems(state.overview.trash, state.sort), state.page).map((item) => item.id);
}

export function visibleSelection(state: Pick<ClientState, 'selected' | 'tab' | 'overview' | 'page' | 'sort'>): string[] {
  const visible = new Set(selectableIds(state));
  return state.selected.filter((id) => visible.has(id));
}

export function canExecutePreview(preview: Preview | null, now = Date.now()): boolean {
  return preview !== null && preview.expiresAt > now && preview.items.some((item) => item.disposition !== 'blocked');
}

/** Owns only browser view state. Mutation requests continue if the dialog is closed. */
export class ArchiveClientController {
  private state: ClientState = {
    open: false, tab: 'archived', page: 0, sort: 'default', overview: null, selected: [], loading: false,
    busy: false, preview: null, result: null, error: null, uncertainRequest: false,
    storage: { workspaceId: '', scanning: false, result: null, error: null, cancelled: false },
  };
  private readonly listeners = new Set<() => void>();
  private loadGeneration = 0;
  private previewGeneration = 0;
  private openGeneration = 0;
  private scanGeneration = 0;
  private scanAbort: AbortController | null = null;
  private disposed = false;
  private uncertainMutation: Mutation | null = null;
  private readonly knownTitles = new Map<string, string>();

  constructor(
    private readonly api: ArchiveApi,
    private readonly createId: () => string = () => globalThis.crypto.randomUUID(),
    private readonly now: () => number = () => Date.now(),
  ) {}

  getSnapshot = (): ClientState => this.state;
  get storageAvailable(): boolean { return typeof this.api.storage === 'function'; }
  setMaintenance = (maintenance: boolean): void => {
    this.update({ maintenance, ...(maintenance ? { preview: null, selected: [] } : {}) });
  };
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private update(patch: Partial<ClientState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  async open(sessionId?: string): Promise<void> {
    const generation = ++this.openGeneration;
    this.previewGeneration++;
    this.cancelStorage();
    this.update({ open: true, tab: 'archived', page: 0, selected: [], preview: null, error: this.uncertainMutation ? this.state.error : null });
    await this.refresh();
    if (!sessionId || generation !== this.openGeneration || !this.state.open || this.state.busy || this.uncertainMutation || this.state.error || !this.state.overview?.support.supported) return;
    const index = sortedItems(this.state.overview.archived, this.state.sort).findIndex((item) => item.id === sessionId && !item.pending);
    if (index < 0) return;
    this.update({ page: Math.floor(index / PAGE_SIZE), selected: [sessionId] });
    await this.preview('trash', [sessionId]);
  }

  close = (): void => {
    this.openGeneration++;
    this.previewGeneration++;
    this.cancelStorage();
    this.update({ open: false, preview: null, selected: [], loading: false });
  };

  setTab = (tab: ArchiveTab): void => {
    if (this.state.busy || this.state.loading || this.uncertainMutation || this.state.tab === tab) return;
    this.previewGeneration++;
    this.cancelStorage();
    this.update({ tab, page: 0, selected: [], preview: null, error: null });
  };

  setSort = (sort: ArchiveSort): void => {
    if (this.state.busy || this.state.loading || this.uncertainMutation || this.state.tab === 'storage'
      || !['default', 'size-desc'].includes(sort) || this.state.sort === sort) return;
    this.previewGeneration++;
    this.update({ sort, page: 0, selected: [], preview: null, error: null });
  };

  setStorageWorkspace = (workspaceId: string): void => {
    if (!this.state.open || this.state.tab !== 'storage' || this.state.storage.workspaceId === workspaceId
      || (workspaceId !== '' && !this.state.overview?.storageWorkspaces?.some(item => item.id === workspaceId))) return;
    this.cancelStorage();
    this.update({ storage: { workspaceId, scanning: false, result: null, error: null, cancelled: false } });
  };

  /** Read-only scans have their own lifetime and cannot create or resolve mutations. */
  async scanStorage(scope: 'host' | 'workspace'): Promise<void> {
    if (this.disposed || !this.state.open || this.state.tab !== 'storage' || !this.api.storage
      || !this.state.overview?.support.supported) return;
    const workspaceId = scope === 'workspace' ? this.state.storage.workspaceId : undefined;
    if (scope === 'workspace' && (!workspaceId || !this.state.overview.storageWorkspaces?.some(item => item.id === workspaceId))) return;
    this.cancelStorage();
    const generation = ++this.scanGeneration;
    const abort = new AbortController();
    this.scanAbort = abort;
    this.update({ storage: { ...this.state.storage, scanning: true, result: null, error: null, cancelled: false } });
    try {
      const result = await this.api.storage(workspaceId, abort.signal);
      if (generation !== this.scanGeneration || abort.signal.aborted || this.disposed || !this.state.open || this.state.tab !== 'storage') return;
      if (result.scope !== scope || result.workspaceId !== workspaceId) throw new ClientTransportError('DSH returned storage details for a different scope.');
      this.scanAbort = null;
      this.update({ storage: { ...this.state.storage, scanning: false, result, error: null } });
    } catch (error) {
      if (generation !== this.scanGeneration || abort.signal.aborted || this.disposed || !this.state.open || this.state.tab !== 'storage') return;
      this.scanAbort = null;
      this.update({ storage: { ...this.state.storage, scanning: false, error: this.error(error, false) } });
    }
  }

  cancelStorage = (): void => {
    this.scanGeneration++;
    this.scanAbort?.abort();
    this.scanAbort = null;
    if (this.state.storage.scanning) this.update({ storage: { ...this.state.storage, scanning: false, cancelled: true } });
  };

  setPage = (page: number): void => {
    if (this.state.busy || this.state.loading || this.uncertainMutation || !Number.isInteger(page)) return;
    const next = Math.max(0, Math.min(page, pageCount(this.state) - 1));
    if (next === this.state.page) return;
    this.previewGeneration++;
    this.update({ page: next, selected: [], preview: null, error: null });
  };

  toggle = (id: string): void => {
    if (this.state.busy || this.state.loading || this.uncertainMutation || !selectableIds(this.state).includes(id)) return;
    const selected = new Set(visibleSelection(this.state));
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    this.update({ selected: [...selected], preview: null });
  };

  selectAll = (selected: boolean): void => {
    if (this.state.busy || this.state.loading || this.uncertainMutation) return;
    this.update({ selected: selected ? selectableIds(this.state) : [], preview: null });
  };

  async refresh(): Promise<void> {
    const generation = ++this.loadGeneration;
    this.update({ loading: true });
    try {
      const received = await this.api.list();
      if (generation !== this.loadGeneration || this.disposed) return;
      for (const item of received.archived) this.knownTitles.set(item.id, item.title);
      for (const item of received.trash) {
        this.knownTitles.set(item.id, item.title);
        this.knownTitles.set(item.sessionId, item.title);
      }
      const overview = { ...received, recentResults: received.recentResults.map(this.withKnownTitles) };
      if (this.state.storage.workspaceId && !overview.storageWorkspaces?.some(item => item.id === this.state.storage.workspaceId)) {
        this.cancelStorage();
        this.update({ storage: { workspaceId: '', scanning: false, result: null, error: null, cancelled: false } });
      }
      this.update({ overview, page: Math.min(this.state.page, pageCount({ overview, tab: this.state.tab }) - 1), loading: false, error: this.uncertainMutation ? this.state.error : null });
      this.update({ selected: visibleSelection(this.state) });
      const recovered = this.uncertainMutation
        ? overview.recentResults.find((item) => item.operationId === this.uncertainMutation?.requestId)
        : undefined;
      if (recovered) {
        this.uncertainMutation = null;
        this.update({ result: recovered, preview: null, selected: [], error: null, uncertainRequest: false });
      }
    } catch (error) {
      if (generation !== this.loadGeneration || this.disposed) return;
      this.update({ loading: false, error: { ...this.error(error, false), code: 'list-failed' } });
    }
  }

  async preview(action: Action, ids = visibleSelection(this.state)): Promise<void> {
    if (this.state.maintenance || this.state.busy || this.state.tab === 'storage' || this.uncertainMutation || ids.length === 0) return;
    const generation = ++this.previewGeneration;
    this.update({ loading: true, error: null, preview: null });
    try {
      const preview = await this.api.preview(action, [...new Set(ids)]);
      if (generation !== this.previewGeneration || !this.state.open || this.disposed) return;
      for (const item of preview.items) if (item.title) this.knownTitles.set(item.id, item.title);
      this.update({ preview, loading: false });
    } catch (error) {
      if (generation !== this.previewGeneration || this.disposed) return;
      this.update({ loading: false, error: this.error(error, false) });
    }
  }

  dismissPreview = (): void => {
    if (this.state.busy || this.uncertainMutation) return;
    this.previewGeneration++;
    this.update({ preview: null, error: null });
  };

  async confirm(): Promise<void> {
    if (this.state.maintenance || this.state.busy || this.state.loading || this.uncertainMutation) return;
    const preview = this.state.preview;
    if (!canExecutePreview(preview, this.now())) {
      this.update({ error: { code: 'preview-expired', message: 'The preview has expired. Review the selection again.', uncertain: false } });
      return;
    }
    await this.perform({ kind: 'execute', previewId: preview!.id, requestId: this.createId() });
  }

  async cancelPending(ids: readonly string[]): Promise<void> {
    if (this.state.maintenance || this.state.busy || this.uncertainMutation || ids.length === 0) return;
    await this.perform({ kind: 'cancel', ids: [...new Set(ids)], requestId: this.createId() });
  }

  /** Cancel the old queued consent before offering a new, explicit confirmation. */
  async reviewPending(id: string): Promise<void> {
    if (this.state.maintenance || this.disposed || !this.state.open || this.state.busy || this.state.loading || this.uncertainMutation
      || this.state.tab !== 'archived' || !this.state.overview?.support.supported
      || !pageItems(sortedItems(this.state.overview.archived, this.state.sort), this.state.page).some(item => item.id === id && item.pending)) return;
    await this.perform({ kind: 'cancel', ids: [id], requestId: this.createId(), review: { id, openGeneration: this.openGeneration } });
  }

  async retryUncertain(): Promise<void> {
    if (this.state.maintenance || this.state.busy || !this.uncertainMutation) return;
    await this.perform(this.uncertainMutation);
  }

  async retryItem(id: string): Promise<void> {
    const result = this.state.result ?? this.state.overview?.recentResults[0];
    if (!result || !result.items.some((item) => item.id === id && item.status === 'failed')) return;
    if (result.action === 'cancel') await this.cancelPending([id]);
    else await this.preview(result.action, [id]);
  }

  private async perform(mutation: Mutation): Promise<void> {
    this.update({ busy: true, error: null });
    try {
      const result = mutation.kind === 'execute'
        ? await this.api.execute(mutation.previewId, mutation.requestId)
        : await this.api.cancelPending(mutation.ids, mutation.requestId);
      this.uncertainMutation = null;
      this.update({ busy: false, preview: null, selected: [], result: this.withKnownTitles(result), error: null, uncertainRequest: false });
      await this.refresh();
      if (mutation.kind === 'cancel' && mutation.review) {
        const review = mutation.review;
        if (this.disposed || review.openGeneration !== this.openGeneration || !this.state.open || this.state.error
          || this.state.loading || this.uncertainMutation || this.state.tab !== 'archived' || !this.state.overview?.support.supported
          || result.action !== 'cancel' || !result.items.some(item => item.id === review.id && item.status === 'cancelled')) return;
        const index = sortedItems(this.state.overview.archived, this.state.sort).findIndex(item => item.id === review.id && !item.pending);
        if (index < 0) return;
        this.update({ page: Math.floor(index / PAGE_SIZE), selected: [review.id] });
        await this.preview('trash', [review.id]);
      }
    } catch (error) {
      const uncertain = error instanceof ClientTransportError;
      this.uncertainMutation = uncertain ? mutation : null;
      this.update({ busy: false, error: this.error(error, uncertain), uncertainRequest: uncertain });
    }
  }

  /** Retain readable titles only in this client's memory; durable receipts stay redacted. */
  private withKnownTitles = (result: BatchResult): BatchResult => ({
    ...result, items: result.items.map((item) => ({ ...item, title: item.title || this.knownTitles.get(item.id) || '' })),
  });

  private error(error: unknown, uncertain: boolean): ClientError {
    if (error instanceof ArchiveError) return { code: error.code, message: error.message, uncertain };
    return {
      code: uncertain ? 'outcome-unknown' : 'request-failed',
      message: error instanceof Error ? error.message : String(error), uncertain,
    };
  }

  dispose(): void {
    this.cancelStorage();
    this.disposed = true;
    this.loadGeneration++;
    this.previewGeneration++;
    this.knownTitles.clear();
    this.listeners.clear();
  }
}
