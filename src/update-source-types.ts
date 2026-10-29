import type { UpdateCandidate } from './update-contracts.js';

/** Server-owned pin, kept behind the authenticated API boundary. */
export interface PinnedUpdate { candidate: UpdateCandidate; assetUrl: string; sha256: string }
export interface ReleaseCheck {
  availability: 'current' | 'available' | 'incompatible';
  candidate?: UpdateCandidate;
  pinned?: PinnedUpdate;
  code?: string;
}
export interface UpdateSource {
  check(signal?: AbortSignal): Promise<ReleaseCheck>;
  /** Refetch the release metadata; a changed pin must never inherit old consent. */
  revalidate(pin: PinnedUpdate, signal?: AbortSignal): Promise<void>;
  /** Bounded download, SHA-256 and packed manifest validation; no extraction/writes. */
  download(pin: PinnedUpdate, signal?: AbortSignal): Promise<Uint8Array>;
}
