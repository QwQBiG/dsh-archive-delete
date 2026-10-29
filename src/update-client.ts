import { ArchiveError, type ArchiveApi } from './contracts.js';
import { ClientTransportError, type ArchiveClientController } from './client-state.js';
import type { UpdateOverview } from './update-contracts.js';

export interface UpdateClientState {
  data: UpdateOverview | null; checking: boolean; installing: boolean;
  reviewId: string | null; error: string | null; uncertain: boolean;
}
/** Update requests never join the session mutation/retry queue. */
export class UpdateClientController {
  private state: UpdateClientState = { data: null, checking: false, installing: false, reviewId: null, error: null, uncertain: false };
  private readonly listeners = new Set<() => void>();
  private disposed = false;
  private checkGeneration = 0;
  private checking: Promise<void> | undefined;
  private confirmation: { candidateId: string; requestId: string } | undefined;
  private interval: ReturnType<typeof setInterval> | undefined;
  private statusTimer: ReturnType<typeof setTimeout> | undefined;
  private statusAttempts = 0;
  constructor(private readonly api: ArchiveApi, private readonly archive: ArchiveClientController,
    private readonly createId: () => string = () => globalThis.crypto.randomUUID()) {}
  get available(): boolean { return typeof this.api.updates === 'function' && typeof this.api.installUpdate === 'function'; }
  getSnapshot = (): UpdateClientState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  start(): void {
    if (!this.available || this.disposed || this.interval) return;
    void this.check();
    this.interval = setInterval(() => { void this.check(); }, 15 * 60_000);
    this.interval.unref?.();
  }
  private update(patch: Partial<UpdateClientState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener();
  }
  private accept(data: UpdateOverview): void {
    const installation = data.installation;
    const settled = this.confirmation && installation?.requestId === this.confirmation.requestId
      && ['installed', 'restart-required', 'failed', 'interrupted'].includes(installation.status);
    const protectedState = data.currentVersion !== data.installedVersion || installation?.status === 'installing'
      || Boolean(this.confirmation && !settled && this.state.uncertain)
      || installation?.status === 'restart-required' || installation?.status === 'unknown';
    this.archive.setMaintenance(protectedState);
    this.update({ data, reviewId: this.state.reviewId === data.candidate?.id && data.availability === 'available' ? this.state.reviewId : null,
      ...(settled ? { uncertain: false, installing: false, error: null } : {}) });
    if (settled) this.confirmation = undefined;
  }
  private scheduleStatus(): void {
    const waiting = this.state.uncertain || this.state.data?.installation?.status === 'installing';
    if (!waiting) { if (this.statusTimer) clearTimeout(this.statusTimer); this.statusTimer = undefined; this.statusAttempts = 0; return; }
    if (this.disposed || this.statusTimer || this.statusAttempts >= 10) return;
    this.statusTimer = setTimeout(() => { this.statusTimer = undefined; this.statusAttempts++; void this.check(); }, 3_000);
    this.statusTimer.unref?.();
  }
  async check(force = false): Promise<void> {
    if (this.disposed || !this.api.updates || this.state.installing) return;
    if (this.checking) return this.checking;
    const generation = ++this.checkGeneration;
    this.update({ checking: true, error: null });
    const task = (async () => {
      try {
        const data = await this.api.updates!(force);
        if (generation !== this.checkGeneration || this.disposed) return;
        this.accept(data);
      } catch (error) {
        if (generation !== this.checkGeneration || this.disposed) return;
        this.update({ error: error instanceof ArchiveError ? error.code : 'update-network' });
      } finally { if (generation === this.checkGeneration) { this.update({ checking: false }); this.scheduleStatus(); } }
    })();
    this.checking = task;
    void task.finally(() => { if (this.checking === task) this.checking = undefined; }).catch(() => {});
    return task;
  }
  review = (): void => {
    const data = this.state.data; const archive = this.archive.getSnapshot();
    if (!data?.candidate || data.availability !== 'available' || !data.canInstall || this.state.checking || this.state.installing || this.state.uncertain
      || archive.busy || archive.loading || archive.uncertainRequest || archive.maintenance) return;
    this.update({ reviewId: data.candidate.id, error: null });
  };
  cancelReview = (): void => { if (!this.state.installing) this.update({ reviewId: null }); };
  async confirm(): Promise<void> {
    const data = this.state.data; const archive = this.archive.getSnapshot();
    if (!this.api.installUpdate || !data?.candidate || this.state.reviewId !== data.candidate.id || data.availability !== 'available'
      || !data.canInstall || this.state.installing || this.state.checking || this.state.uncertain || archive.busy || archive.loading || archive.uncertainRequest || archive.maintenance) return;
    this.confirmation = { candidateId: data.candidate.id, requestId: this.createId() };
    await this.install();
  }
  async retry(): Promise<void> { if (!this.state.installing && this.state.uncertain && this.confirmation) await this.install(); }
  private async install(): Promise<void> {
    const confirmation = this.confirmation; if (!confirmation || !this.api.installUpdate || this.disposed) return;
    this.checkGeneration++;
    this.archive.setMaintenance(true);
    this.update({ installing: true, checking: false, error: null, reviewId: null });
    try {
      const data = await this.api.installUpdate(confirmation.candidateId, confirmation.requestId);
      if (this.disposed) return;
      if (!data.installation || data.installation.requestId !== confirmation.requestId) throw new ClientTransportError('The update outcome was not recorded.');
      this.accept(data);
      this.update({ installing: false, uncertain: data.installation.status === 'installing' || data.installation.status === 'unknown' });
    } catch (error) {
      if (this.disposed) return;
      const uncertain = !(error instanceof ArchiveError);
      if (!uncertain) { this.confirmation = undefined; this.archive.setMaintenance(/^update-(in-progress|restart-required)$/.test(error.code)); }
      this.update({ installing: false, uncertain, error: uncertain ? 'update-outcome-unknown' : error.code });
    } finally { this.scheduleStatus(); }
  }
  dispose(): void { this.disposed = true; this.checkGeneration++; if (this.interval) clearInterval(this.interval); if (this.statusTimer) clearTimeout(this.statusTimer); this.listeners.clear(); }
}
