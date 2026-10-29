import React, { useCallback, useSyncExternalStore } from 'react';
import { API_PATH, PACKAGE_NAME, ArchiveError, type Action, type ApiRequest, type ArchiveApi, type BatchResult, type Overview, type Preview, type StorageOverview } from './contracts.js';
import { ArchiveClientController, ClientTransportError } from './client-state.js';
import { ArchiveDialog, CLIENT_CSS, CLIENT_NAMESPACE, en, zh, type NativePrimitives, type Translate } from './client-ui.js';
import { UpdateClientController } from './update-client.js';
import { UpdateCard } from './update-ui.js';
import type { UpdateOverview } from './update-contracts.js';

type HostRequire = (name: string) => unknown;
type Observable<T> = { getSnapshot(): T; subscribe(listener: () => void): () => void };
type WorkspaceSnapshot = { archivedSessionIds: readonly string[] };
interface SlotOptions { name: string; id?: string; key?: string; locale: string; order?: number; inject?: () => unknown }
interface ClientContext {
  locale: { register(namespace: string, dictionaries: { en: Record<string, string>; zh: Record<string, string> }): () => void };
  slots: {
    inject(name: string, effect: () => (() => void) | void): () => void;
    register<P>(options: SlotOptions, component: React.ComponentType<P>): () => void;
  };
  workspaces: { list: Observable<WorkspaceSnapshot> };
  effect(effect: () => (() => void), label?: string): unknown;
}
interface MenuProps {
  sessionId: string; displayTitle: string;
  useMenuOpenState(): readonly [boolean, (open: boolean) => void]; t: Translate;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === 'string'); }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function count(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
function workspaces(value: unknown): boolean {
  return Array.isArray(value) && value.every(item => object(item) && typeof item.id === 'string' && typeof item.title === 'string');
}
function relativePath(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && !/^[/\\]|^[a-z]:/i.test(value) && !value.split(/[/\\]/).includes('..');
}

function isOverview(value: unknown): value is Overview {
  return object(value) && object(value.support) && typeof value.support.supported === 'boolean'
    && typeof value.support.version === 'string' && typeof value.support.platform === 'string'
    && Array.isArray(value.archived) && value.archived.every((item) => object(item) && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.workspace === 'string' && finite(item.sizeBytes) && finite(item.descendantCount))
    && Array.isArray(value.trash) && value.trash.every((item) => object(item) && typeof item.id === 'string' && typeof item.sessionId === 'string' && typeof item.title === 'string' && finite(item.trashedAt) && finite(item.sizeBytes) && finite(item.memberCount))
    && Array.isArray(value.recentResults) && value.recentResults.every(isBatchResult)
    && (value.storageWorkspaces === undefined || workspaces(value.storageWorkspaces));
}
function isStorageOverview(value: unknown): value is StorageOverview {
  if (!object(value) || value.metric !== 'logical-file-bytes' || !['host', 'workspace'].includes(String(value.scope))
    || !workspaces(value.workspaces) || (value.workspaceId !== undefined && typeof value.workspaceId !== 'string')
    || (value.scope === 'workspace' ? !value.workspaceId : value.workspaceId !== undefined)
    || typeof value.complete !== 'boolean' || !finite(value.durationMs) || value.durationMs < 0
    || !['startedAt', 'finishedAt', 'fileBytes', 'referencedBytes', 'fileCount', 'uniqueFileCount', 'duplicateHardlinks', 'duplicatePaths', 'identityUnknown'].every(key => count(value[key]))
    || !Array.isArray(value.categories)) return false;
  return value.categories.every(category => object(category) && typeof category.id === 'string' && typeof category.kind === 'string'
    && (category.label === undefined || typeof category.label === 'string') && category.readOnly === true
    && ['complete', 'partial', 'missing', 'unavailable'].includes(String(category.status))
    && (category.fileBytes === null || count(category.fileBytes)) && (category.referencedBytes === null || count(category.referencedBytes))
    && count(category.fileCount) && count(category.uniqueFileCount) && object(category.counters)
    && ['entries', 'files', 'directories', 'symlinks', 'unreadable', 'changed', 'unsupported', 'crossDevice', 'depthLimit', 'duplicateHardlinks', 'duplicatePaths', 'identityUnknown', 'excluded'].every(key => count((category.counters as Record<string, unknown>)[key]))
    && strings(category.overlaps)
    && Array.isArray(category.issues) && category.issues.every(issue => object(issue) && typeof issue.code === 'string' && (issue.relativePath === undefined || relativePath(issue.relativePath)))
    && Array.isArray(category.largestFiles) && category.largestFiles.every(file => object(file) && relativePath(file.relativePath) && count(file.sizeBytes) && file.source === 'unknown')
    && Array.isArray(category.directories) && category.directories.every(directory => object(directory) && relativePath(directory.relativePath) && count(directory.fileBytes) && count(directory.fileCount)));
}
function isPreview(value: unknown): value is Preview {
  return object(value) && typeof value.id === 'string' && ['trash', 'restore', 'purge'].includes(String(value.action)) && finite(value.expiresAt)
    && Array.isArray(value.items) && value.items.every((item) => object(item) && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.sessionId === 'string' && strings(item.memberIds) && finite(item.sizeBytes) && ['ready', 'pending', 'blocked'].includes(String(item.disposition)));
}
function isBatchResult(value: unknown): value is BatchResult {
  return object(value) && typeof value.operationId === 'string' && ['trash', 'restore', 'purge', 'cancel'].includes(String(value.action))
    && object(value.counts) && ['succeeded', 'pending', 'skipped', 'failed'].every((key) => finite((value.counts as Record<string, unknown>)[key]))
    && Array.isArray(value.items) && value.items.every((item) => object(item) && typeof item.id === 'string' && typeof item.title === 'string' && ['moved', 'pending', 'restored', 'purged', 'cancelled', 'skipped', 'failed'].includes(String(item.status)));
}
function isUpdateOverview(value: unknown): value is UpdateOverview {
  const version = (v: unknown) => typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v);
  if (!object(value) || !version(value.currentVersion) || !version(value.installedVersion) || typeof value.hostVersion !== 'string'
    || !['unknown', 'current', 'available', 'incompatible', 'error'].includes(String(value.availability)) || typeof value.canInstall !== 'boolean'
    || (value.checkedAt !== undefined && !count(value.checkedAt)) || (value.nextCheckAt !== undefined && !count(value.nextCheckAt))
    || (value.code !== undefined && typeof value.code !== 'string')) return false;
  if (value.candidate !== undefined) {
    const c = value.candidate;
    if (!object(c) || typeof c.id !== 'string' || c.id.length > 512 || !version(c.version) || typeof c.requiredDshVersion !== 'string'
      || typeof c.publishedAt !== 'string' || typeof c.notes !== 'string' || c.notes.length > 64_000 || !count(c.assetBytes)
      || c.releaseUrl !== `https://github.com/QwQBiG/dsh-archive-delete/releases/tag/v${c.version}`) return false;
  }
  if (value.availability === 'available' && value.candidate === undefined) return false;
  if (value.installation !== undefined) {
    const i = value.installation;
    if (!object(i) || typeof i.requestId !== 'string' || !version(i.version)
      || !['installing', 'installed', 'restart-required', 'failed', 'interrupted', 'unknown'].includes(String(i.status))
      || (i.code !== undefined && typeof i.code !== 'string')) return false;
  }
  return true;
}

/** Calls only the authenticated, same-origin DSH gateway; neither paths nor credentials are accepted. */
export function createArchiveApi(transport: typeof fetch = globalThis.fetch.bind(globalThis), baseUri?: string): ArchiveApi {
  const base = baseUri ?? document.baseURI;
  const endpoint = new URL(API_PATH.replace(/^\//, ''), base).href;
  const request = async <T,>(body: ApiRequest, accepts: (value: unknown) => value is T, signal?: AbortSignal): Promise<T> => {
    let response: Response;
    try {
      response = await transport(endpoint, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ClientTransportError('The connection to DSH was interrupted.');
    }
    let envelope: unknown;
    try { envelope = await response.json(); }
    catch (error) { if (signal?.aborted) throw error; throw new ClientTransportError('DSH returned an unreadable response.'); }
    if (object(envelope) && envelope.ok === false && object(envelope.error) && typeof envelope.error.code === 'string' && typeof envelope.error.message === 'string') {
      throw new ArchiveError(envelope.error.code, envelope.error.message);
    }
    if (!response.ok || !object(envelope) || envelope.ok !== true || !accepts(envelope.value)) {
      throw new ClientTransportError('DSH returned an unexpected response.');
    }
    return envelope.value;
  };
  return {
    list: () => request({ action: 'list' }, isOverview),
    preview: (operation: Action, ids: string[]) => request({ action: 'preview', operation, ids }, isPreview),
    execute: (previewId, requestId) => request({ action: 'execute', previewId, requestId }, isBatchResult),
    cancelPending: (ids, requestId) => request({ action: 'cancelPending', ids, requestId }, isBatchResult),
    storage: (workspaceId, signal) => request({ action: 'storage', ...(workspaceId ? { workspaceId } : {}) }, isStorageOverview, signal),
    updates: (force = false) => request({ action: 'updates', force }, isUpdateOverview),
    installUpdate: (candidateId, requestId) => request({ action: 'installUpdate', candidateId, requestId }, isUpdateOverview),
  };
}

/** Entry point called by the DSH Module Loader wrapper generated at build time. */
export function startClient(require: HostRequire, apiFactory: () => ArchiveApi = () => createArchiveApi()) {
  const primitives = require('@deepseek-ai/dsh-client-ui-primitives') as NativePrimitives & {
    MenuItemButton: React.ComponentType<{ children?: React.ReactNode; onSelect(): void; disabled?: boolean; danger?: boolean; separatorBefore?: boolean }>;
  };
  return {
    name: 'archive-delete-client',
    inject: ['slots', 'locale', 'workspaces'],
    apply(ctx: ClientContext): void {
      const api = apiFactory();
      const controller = new ArchiveClientController(api);
      const updates = new UpdateClientController(api, controller);
      const disposers: Array<() => void> = [];
      ctx.effect(() => ctx.locale.register(CLIENT_NAMESPACE, { en, zh }), 'archive-delete: locale');
      ctx.effect(() => { updates.start(); return () => updates.dispose(); }, 'archive-delete: update checks');
      ctx.effect(() => {
        if (typeof document === 'undefined') return () => {};
        const style = document.createElement('style');
        style.dataset.dshArchiveDelete = '';
        style.textContent = CLIENT_CSS;
        document.head.append(style);
        return () => style.remove();
      }, 'archive-delete: styles');

      function MoveToTrashItem({ sessionId, useMenuOpenState, t }: MenuProps) {
        const [, setMenuOpen] = useMenuOpenState();
        const subscribe = useCallback((listener: () => void) => ctx.workspaces.list.subscribe(listener), []);
        const snapshot = useCallback(() => ctx.workspaces.list.getSnapshot().archivedSessionIds.includes(sessionId), [sessionId]);
        const archived = useSyncExternalStore(subscribe, snapshot, snapshot);
        if (!archived) return null;
        return <primitives.MenuItemButton separatorBefore onSelect={() => { setMenuOpen(false); void controller.open(sessionId); }}>{t('menuTrash')}</primitives.MenuItemButton>;
      }
      function Overlay({ t }: { t: Translate }) {
        return <ArchiveDialog controller={controller} primitives={primitives} t={t} updates={updates} />;
      }
      function ConfigCard({ view, t }: { view?: string; t: Translate }) {
        if (view === 'summary') return null;
        return <div className="dad-shell"><primitives.Button variant="outline" onClick={() => { void controller.open(); }}>{t('manage')}</primitives.Button><UpdateCard controller={updates} Button={primitives.Button} t={t} /></div>;
      }

      disposers.push(ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
        name: 'sidebar.workspaces.session.menu.item', id: 'qwqbig.archive-delete.trash',
        order: 520, locale: CLIENT_NAMESPACE,
      }, MoveToTrashItem)));
      disposers.push(ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay', id: 'qwqbig.archive-delete.dialog', locale: CLIENT_NAMESPACE,
      }, Overlay)));
      disposers.push(ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config', key: PACKAGE_NAME, locale: CLIENT_NAMESPACE,
      }, ConfigCard)));
      ctx.effect(() => () => {
        controller.dispose();
        for (const dispose of disposers.reverse()) dispose();
      }, 'archive-delete: client lifecycle');
    },
  };
}
