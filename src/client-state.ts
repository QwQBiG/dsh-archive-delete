import { ArchiveError, type Action, type ArchiveApi, type BatchResult, type Overview, type Preview } from './contracts.js';

export type ArchiveTab = 'archived' | 'trash';
export interface ClientError { code: string; message: string; uncertain: boolean }
export interface ClientState {
  open: boolean;
  tab: ArchiveTab;
  overview: Overview | null;
  selected: readonly string[];
  loading: boolean;
  busy: boolean;
  preview: Preview | null;
  result: BatchResult | null;
  error: ClientError | null;
  uncertainRequest: boolean;
}

export class ClientTransportError extends Error {
  constructor(message: string) { super(message); this.name = 'ClientTransportError'; }
}

type Mutation =
  | { kind: 'execute'; previewId: string; requestId: string }
  | { kind: 'cancel'; ids: string[]; requestId: string };

/** IDs currently eligible for selection; pending entries have a dedicated cancel action. */
export function selectableIds(state: Pick<ClientState, 'tab' | 'overview'>): string[] {
  if (!state.overview) return [];
  return state.tab === 'archived'
    ? state.overview.archived.filter((item) => !item.pending).map((item) => item.id)
    : state.overview.trash.map((item) => item.id);
}

export function visibleSelection(state: Pick<ClientState, 'selected' | 'tab' | 'overview'>): string[] {
  const visible = new Set(selectableIds(state));
  return state.selected.filter((id) => visible.has(id));
}

export function canExecutePreview(preview: Preview | null, now = Date.now()): boolean {
  return preview !== null && preview.expiresAt > now && preview.items.some((item) => item.disposition !== 'blocked');
}

/** Owns only browser view state. Mutation requests continue if the dialog is closed. */
export class ArchiveClientController {
  private state: ClientState = {
    open: false, tab: 'archived', overview: null, selected: [], loading: false,
    busy: false, preview: null, result: null, error: null, uncertainRequest: false,
  };
  private readonly listeners = new Set<() => void>();
  private loadGeneration = 0;
  private previewGeneration = 0;
  private openGeneration = 0;
  private disposed = false;
  private uncertainMutation: Mutation | null = null;
  private readonly knownTitles = new Map<string, string>();

  constructor(
    private readonly api: ArchiveApi,
    private readonly createId: () => string = () => globalThis.crypto.randomUUID(),
    private readonly now: () => number = () => Date.now(),
  ) {}

  getSnapshot = (): ClientState => this.state;
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
    this.update({ open: true, tab: 'archived', selected: [], preview: null, error: this.uncertainMutation ? this.state.error : null });
    await this.refresh();
    if (!sessionId || generation !== this.openGeneration || !this.state.open || this.state.busy || this.uncertainMutation || this.state.error || !this.state.overview?.support.supported) return;
    if (!selectableIds(this.state).includes(sessionId)) return;
    this.update({ selected: [sessionId] });
    await this.preview('trash', [sessionId]);
  }

  close = (): void => {
    this.openGeneration++;
    this.previewGeneration++;
    this.update({ open: false, preview: null, selected: [], loading: false });
  };

  setTab = (tab: ArchiveTab): void => {
    if (this.state.busy || this.state.loading || this.state.tab === tab) return;
    this.previewGeneration++;
    this.update({ tab, selected: [], preview: null, error: null });
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
      this.update({ overview, loading: false, error: this.uncertainMutation ? this.state.error : null });
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
    if (this.state.busy || this.uncertainMutation || ids.length === 0) return;
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
    if (this.state.busy || this.state.loading || this.uncertainMutation) return;
    const preview = this.state.preview;
    if (!canExecutePreview(preview, this.now())) {
      this.update({ error: { code: 'preview-expired', message: 'The preview has expired. Review the selection again.', uncertain: false } });
      return;
    }
    await this.perform({ kind: 'execute', previewId: preview!.id, requestId: this.createId() });
  }

  async cancelPending(ids: readonly string[]): Promise<void> {
    if (this.state.busy || this.uncertainMutation || ids.length === 0) return;
    await this.perform({ kind: 'cancel', ids: [...new Set(ids)], requestId: this.createId() });
  }

  async retryUncertain(): Promise<void> {
    if (this.state.busy || !this.uncertainMutation) return;
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
    this.disposed = true;
    this.loadGeneration++;
    this.previewGeneration++;
    this.knownTitles.clear();
    this.listeners.clear();
  }
}
