import React, { useCallback, useSyncExternalStore } from 'react';
import { API_PATH, PACKAGE_NAME, ArchiveError, type Action, type ApiRequest, type ArchiveApi, type BatchResult, type Overview, type Preview } from './contracts.js';
import { ArchiveClientController, ClientTransportError } from './client-state.js';
import { ArchiveDialog, CLIENT_CSS, CLIENT_NAMESPACE, en, zh, type NativePrimitives, type Translate } from './client-ui.js';

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

function isOverview(value: unknown): value is Overview {
  return object(value) && object(value.support) && typeof value.support.supported === 'boolean'
    && typeof value.support.version === 'string' && typeof value.support.platform === 'string'
    && Array.isArray(value.archived) && value.archived.every((item) => object(item) && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.workspace === 'string' && finite(item.sizeBytes) && finite(item.descendantCount))
    && Array.isArray(value.trash) && value.trash.every((item) => object(item) && typeof item.id === 'string' && typeof item.sessionId === 'string' && typeof item.title === 'string' && finite(item.trashedAt) && finite(item.sizeBytes) && finite(item.memberCount))
    && Array.isArray(value.recentResults) && value.recentResults.every(isBatchResult);
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

/** Calls only the authenticated, same-origin DSH gateway; neither paths nor credentials are accepted. */
export function createArchiveApi(transport: typeof fetch = globalThis.fetch.bind(globalThis), baseUri?: string): ArchiveApi {
  const base = baseUri ?? document.baseURI;
  const endpoint = new URL(API_PATH.replace(/^\//, ''), base).href;
  const request = async <T,>(body: ApiRequest, accepts: (value: unknown) => value is T): Promise<T> => {
    let response: Response;
    try {
      response = await transport(endpoint, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body),
      });
    } catch {
      throw new ClientTransportError('The connection to DSH was interrupted.');
    }
    let envelope: unknown;
    try { envelope = await response.json(); }
    catch { throw new ClientTransportError('DSH returned an unreadable response.'); }
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
      const controller = new ArchiveClientController(apiFactory());
      const disposers: Array<() => void> = [];
      ctx.effect(() => ctx.locale.register(CLIENT_NAMESPACE, { en, zh }), 'archive-delete: locale');
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
        return <ArchiveDialog controller={controller} primitives={primitives} t={t} />;
      }
      function ConfigCard({ view, t }: { view?: string; t: Translate }) {
        if (view === 'summary') return null;
        return <primitives.Button variant="outline" onClick={() => { void controller.open(); }}>{t('manage')}</primitives.Button>;
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
