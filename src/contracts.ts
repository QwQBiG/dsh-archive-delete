import type { UsageScanResult } from './storage-usage.js';
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export const PACKAGE_NAME = '@qwqbig/dsh-archive-delete';
export const API_PATH = '/api/dsh-archive-delete';
export const SUPPORTED_DSH_VERSION = '0.2.1-rc.3';

export interface SupportStatus { supported: boolean; version: string; platform: string; reason?: string }
export interface Activity { kind: string; label: string }
export interface SessionMember {
  id: string;
  title: string;
  directory: string;
  revision: string;
  header: JsonObject;
  workspaceId?: string;
  workspacePath?: string;
  accountIndex?: number;
  archived: boolean;
  pinned: boolean;
  loaded: boolean;
  activity: Activity[];
  sizeBytes: number;
}
export interface SessionGroup { sessionId: string; title: string; sessionsRoot: string; members: SessionMember[] }
export interface ArchivedSession {
  id: string; title: string; workspace: string; sizeBytes: number; descendantCount: number;
  pending?: boolean; pendingReason?: string;
}
export interface TrashEntry {
  id: string; sessionId: string; title: string; trashedAt: number; sizeBytes: number; memberCount: number;
}
export type Action = 'trash' | 'restore' | 'purge';
export type ItemStatus = 'moved' | 'pending' | 'restored' | 'purged' | 'cancelled' | 'skipped' | 'failed';
export interface ItemResult { id: string; title: string; status: ItemStatus; code?: string; message?: string }
export interface BatchResult {
  operationId: string; action: Action | 'cancel'; items: ItemResult[];
  counts: { succeeded: number; pending: number; skipped: number; failed: number };
}
export interface PreviewItem {
  id: string; title: string; sessionId: string; memberIds: string[]; sizeBytes: number;
  disposition: 'ready' | 'pending' | 'blocked'; code?: string; message?: string;
}
export interface Preview { id: string; action: Action; items: PreviewItem[]; expiresAt: number }
export interface Overview { support: SupportStatus; archived: ArchivedSession[]; trash: TrashEntry[]; recentResults: BatchResult[]; storageWorkspaces?: StorageWorkspace[] }
export interface StorageWorkspace { id: string; title: string }
export interface StorageOverview extends UsageScanResult {
  scope: 'host' | 'workspace';
  workspaces: StorageWorkspace[];
  workspaceId?: string;
}
export type ApiRequest =
  | { action: 'list' }
  | { action: 'preview'; operation: Action; ids: string[] }
  | { action: 'execute'; previewId: string; requestId: string }
  | { action: 'cancelPending'; ids: string[]; requestId: string }
  | { action: 'storage'; workspaceId?: string };
export type ApiResponse = { ok: true; value: Overview | Preview | BatchResult | StorageOverview } | { ok: false; error: { code: string; message: string } };
export interface ArchiveApi {
  list(): Promise<Overview>;
  preview(action: Action, ids: string[]): Promise<Preview>;
  execute(previewId: string, requestId: string): Promise<BatchResult>;
  cancelPending(ids: string[], requestId: string): Promise<BatchResult>;
  storage?(workspaceId?: string, signal?: AbortSignal): Promise<StorageOverview>;
}
export interface Lease { release(): Promise<void> }
export type LeaseResult = { kind: 'acquired'; lease: Lease } | { kind: 'loaded'; message: string } | { kind: 'busy'; message: string };
export interface DshAdapter {
  capabilities(): Promise<SupportStatus>;
  listArchived(): Promise<ArchivedSession[]>;
  inspect(sessionId: string): Promise<SessionGroup>;
  acquire(group: SessionGroup): Promise<LeaseResult>;
  /** Optional pinned host lifecycle capability. No active work or raw locks may be forced closed. */
  releaseIdle?(group: SessionGroup): Promise<boolean>;
  acquireLocated(group: SessionGroup, directories: (string | undefined)[]): Promise<LeaseResult>;
  removeRegistry(group: SessionGroup): Promise<void>;
  restoreRegistry(group: SessionGroup): Promise<void>;
}
export class ArchiveError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'ArchiveError'; }
}
