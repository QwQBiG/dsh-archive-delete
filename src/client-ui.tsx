import React, { useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { SUPPORTED_DSH_VERSION, type Action, type BatchResult, type ItemStatus, type Preview, type SupportStatus } from './contracts.js';
import { ArchiveClientController, canExecutePreview, pageCount, pageItems, selectableIds, visibleSelection, type ArchiveTab, type ClientError, type ClientState } from './client-state.js';

export const CLIENT_NAMESPACE = 'qwqbig.archiveDelete';
export const en = {
  title: 'Archives & trash', manage: 'Manage archives and trash', menuTrash: 'Move to trash',
  archived: 'Archived', trash: 'Trash', close: 'Close', refresh: 'Refresh', cancel: 'Cancel', back: 'Back',
  loading: 'Loading…', working: 'Processing the selected records…',
  intro: 'Clean up archived conversations, with the option to restore them.',
  scope: 'Session logs and their dedicated subagent logs are included. Shared attachments, spill files, project files and other plugins’ caches are retained.',
  noArchives: 'No archived conversations', noTrash: 'Your trash is empty',
  emptyArchivesHint: 'Conversations you archive in DSH will appear here.', emptyTrashHint: 'Moved conversations stay here until you restore or delete them.',
  selectAll: 'Select all ({n})', selected: '{n} selected',
  moveSelected: 'Move selected to trash', restoreSelected: 'Restore selected', purgeSelected: 'Delete permanently',
  moveTitle: 'Move these conversations to trash?', restoreTitle: 'Restore these conversations?', purgeTitle: 'Permanently delete these conversations?',
  moveDescription: 'Review the selected conversations and dedicated subagents. Confirmation can try to release idle DSH sessions without restarting. Active work and other processes remain protected; a session that cannot be released stays pending.',
  restoreDescription: 'Restore the original logs in their archived state. A missing workspace becomes Ungrouped; existing paths will never be overwritten.',
  purgeDescription: 'Confirm to delete the selected session logs and recovery records now, without restarting DSH. Busy entries remain protected. This cannot be undone.',
  confirmTrash: 'Confirm move to trash', confirmRestore: 'Confirm restore', confirmPurge: 'Confirm permanent deletion',
  previewExpired: 'This preview expired. Go back and review your selection again.',
  previewEmpty: 'No eligible records remain. Go back and refresh the list.',
  archivedHint: 'Running work and uncertain relationships stay protected.',
  trashHint: 'Permanently delete selected trash after confirmation without restarting DSH. Restored conversations remain archived.',
  retention: 'No automatic deletion', scopeTitle: 'What this includes',
  pages: 'Conversation pages', previousPage: 'Previous', nextPage: 'Next', pageNumber: 'Page {page} of {pages}',
  pending: 'Pending restart', pendingHint: 'No disk space has been freed yet. Confirmation can try releasing an idle DSH session without restarting; if release is unavailable, the move stays pending.',
  cancelPending: 'Cancel pending move', reviewPending: 'Cancel waiting and review', pendingCancelled: 'Pending move cancelled',
  childCount: 'Subagents: {n}', memberCount: 'Conversations: {n}',
  ready: 'Ready', blocked: 'Protected', pendingPreview: 'Try idle release',
  previewCount: 'Selected: {n}', previewMembers: 'Conversations: {n}',
  previewSize: 'Session log size: {size}', expires: 'Confirmation is valid until {time}.',
  result: 'Latest result', resultDetails: 'View details', resultSummary: '{succeeded} succeeded · {pending} pending · {skipped} skipped · {failed} failed',
  retry: 'Review and retry', retryRequest: 'Retry the same request', unknown: 'The request outcome is unknown. Refresh to check the host, or retry the same request without creating a second operation.',
  error: 'The operation could not be completed.', unsupported: 'Data operations are unavailable on this host.',
  supportDetails: 'Host: {version} · {platform}', errorDetails: 'Details', ungrouped: 'Ungrouped',
  'status.moved': 'Moved to trash', 'status.pending': 'Pending restart', 'status.restored': 'Restored',
  'status.purged': 'Permanently deleted', 'status.cancelled': 'Cancelled', 'status.skipped': 'Skipped', 'status.failed': 'Failed',
  checking: 'Checking the selected records…', operationContinues: 'Closing this window does not cancel an operation already sent to DSH.',
  listFailure: 'Unable to read the current records. Refresh to try again.',
  reasonActive: 'This conversation or a related task is active. Finish it before continuing.',
  reasonBusy: 'Another process holds the session write lock. Close that instance and review again.',
  reasonLoaded: 'DSH still holds this idle conversation. It remains pending; cancel waiting and review to try again, or let the next startup recheck it.',
  reasonLifecycle: 'DSH could not safely verify who owns this conversation. Its logs have not been moved. Refresh and review again.',
  reasonRelease: 'DSH could not safely release this idle conversation. Its logs have not been moved. Refresh and review again.',
  reasonChanged: 'The archive state or session content changed. Review a new preview.',
  reasonRecovery: 'An interrupted operation needs recovery before another change is allowed.',
  reasonInterrupted: 'This operation was interrupted. Review its current state before retrying.',
  reasonPending: 'This conversation is already pending. Cancel waiting and review for a fresh confirmation.',
  reasonArchived: 'Only archived conversations can be moved to trash.',
  reasonMissing: 'The selected record no longer exists. Refresh the list.',
  reasonLineage: 'A related conversation has uncertain ownership. This group is protected.',
  reasonPath: 'A storage path or file is unsafe or has changed. No overwrite is allowed.',
  reasonConflict: 'A restore destination already exists. It will not be overwritten.',
  reasonOverlap: 'These selections share a related conversation. Select each group once.',
  reasonPlatform: 'This release supports macOS and Windows Desktop.',
  reasonVersion: 'DSH Desktop {required} is required. Current version: {current}. Update DSH Desktop to {required}, then restart this plugin.',
  reasonBackend: 'The official JSONL storage backend is required.',
  reasonCapabilities: 'Required DSH services are unavailable or incompatible.',
  reasonInitialization: 'Archive storage could not be initialized. Check the host diagnostics and reload the plugin.',
  reasonStoreBusy: 'Another DSH process owns this trash store. Close that instance before continuing.',
} as const;
export type TextKey = keyof typeof en;
export type Translate = (key: TextKey, values?: Record<string, string | number>) => string;
export const zh: Record<TextKey, string> = {
  title: '归档与回收站', manage: '管理归档与回收站', menuTrash: '移入回收站',
  archived: '已归档', trash: '回收站', close: '关闭', refresh: '刷新', cancel: '取消', back: '返回',
  loading: '正在读取…', working: '正在处理选中的记录…',
  intro: '清理已归档会话，需要时可以恢复。',
  scope: '处理范围包含会话日志及其专属子代理日志。共享附件、spill 文件、项目文件和其他插件缓存会保留。',
  noArchives: '暂无已归档会话', noTrash: '回收站为空',
  emptyArchivesHint: '在 DSH 中归档的会话会显示在这里。', emptyTrashHint: '移入的会话会保留，直到你选择恢复或清除。',
  selectAll: '全选（{n}）', selected: '已选择 {n} 项',
  moveSelected: '将所选移入回收站', restoreSelected: '恢复所选', purgeSelected: '永久清除',
  moveTitle: '将这些会话移入回收站？', restoreTitle: '恢复这些会话？', purgeTitle: '永久清除这些会话？',
  moveDescription: '请核对所选会话及专属子代理。确认后可尝试安全释放 DSH 持有的闲置会话，无需重启；运行中的任务和其他进程的占用会受保护，无法释放时仍保留待处理。',
  restoreDescription: '恢复原始日志并保持已归档状态。原工作区不存在时归入“未分组”，不会覆盖已有路径。',
  purgeDescription: '确认后直接清除所选会话日志与恢复记录，无需重启 DSH。仍被占用的条目会受保护，此操作无法撤销。',
  confirmTrash: '确认移入回收站', confirmRestore: '确认恢复', confirmPurge: '确认永久清除',
  previewExpired: '预览已过期，请返回并重新核对目标。',
  previewEmpty: '没有可操作记录，请返回并刷新列表。',
  archivedHint: '运行中的工作与关联不明的会话会受到保护。',
  trashHint: '回收站内容确认后即可永久清除，无需重启 DSH；恢复后仍保持已归档状态。',
  retention: '不会自动清除', scopeTitle: '处理范围',
  pages: '会话分页', previousPage: '上一页', nextPage: '下一页', pageNumber: '第 {page} / {pages} 页',
  pending: '待重启处理', pendingHint: '目前尚未释放磁盘空间。确认后可尝试安全释放 DSH 持有的闲置会话，无需重启；无法释放时仍保留待处理。',
  cancelPending: '取消待处理', reviewPending: '取消等待并重新核对', pendingCancelled: '已取消待处理',
  childCount: '子代理 {n}', memberCount: '会话 {n} 个',
  ready: '可执行', blocked: '已保护', pendingPreview: '尝试释放闲置占用',
  previewCount: '已选择 {n} 项', previewMembers: '共 {n} 个会话',
  previewSize: '会话日志大小：{size}', expires: '本次确认在 {time} 前有效。',
  result: '最近结果', resultDetails: '查看明细', resultSummary: '成功 {succeeded} · 待处理 {pending} · 跳过 {skipped} · 失败 {failed}',
  retry: '重新核对并重试', retryRequest: '重试同一次请求', unknown: '请求结果未知。可以刷新核对宿主状态，或重试同一次请求，不会创建第二次操作。',
  error: '操作未能完成。', unsupported: '当前宿主暂不支持数据操作。',
  supportDetails: '宿主：{version} · {platform}', errorDetails: '详情', ungrouped: '未分组',
  'status.moved': '已移入回收站', 'status.pending': '待重启处理', 'status.restored': '已恢复',
  'status.purged': '已永久清除', 'status.cancelled': '已取消', 'status.skipped': '已跳过', 'status.failed': '失败',
  checking: '正在核对所选记录…', operationContinues: '关闭此窗口不会取消已经发送给 DSH 的操作。',
  listFailure: '无法读取当前记录，请刷新重试。',
  reasonActive: '此会话或关联任务正在运行，请完成后重新核对。',
  reasonBusy: '其他进程持有会话写锁，请关闭相应实例后重新核对。',
  reasonLoaded: 'DSH 仍持有此闲置会话，暂保留待处理；可以取消等待并重新核对后再试，或等下次启动复查。',
  reasonLifecycle: 'DSH 无法安全确认此会话的持有状态，日志尚未移动。请刷新后重新核对。',
  reasonRelease: 'DSH 未能安全释放此闲置会话，日志尚未移动。请刷新后重新核对。',
  reasonChanged: '归档状态或会话内容已经变化，请重新预览并确认。',
  reasonRecovery: '存在需要恢复的中断操作，恢复完成前不能继续修改。',
  reasonInterrupted: '上次操作已中断，请核对当前状态后重新确认。',
  reasonPending: '此会话已处于待处理状态，请取消等待并重新核对后确认。',
  reasonArchived: '只有已归档会话可以移入回收站。',
  reasonMissing: '所选记录已不存在，请刷新列表。',
  reasonLineage: '关联会话的归属不明确，已保护此组记录。',
  reasonPath: '存储路径或文件不安全，或已经变化，不会覆盖已有内容。',
  reasonConflict: '恢复位置已有内容，不会覆盖。',
  reasonOverlap: '所选目标包含同一个关联会话，请勿重复选择同组记录。',
  reasonPlatform: '此版本支持 macOS 和 Windows 桌面端。',
  reasonVersion: '需要 DSH 桌面端 {required}，当前版本为 {current}。请将 DSH 桌面端更新至 {required}，然后重新启动此插件。',
  reasonBackend: '需要使用官方 JSONL 存储后端。',
  reasonCapabilities: '所需的 DSH 服务不可用或不兼容。',
  reasonInitialization: '回收站存储初始化失败，请检查宿主诊断后重新加载插件。',
  reasonStoreBusy: '其他 DSH 进程正在使用此回收站，请关闭相应实例后继续。',
};

export function translator(language: 'en' | 'zh'): Translate {
  const dictionary = language === 'zh' ? zh : en;
  return (key, values = {}) => dictionary[key].replace(/\{([^}]+)\}/g, (match, name: string) => String(values[name] ?? match));
}

/** Stable refusal codes are localized; unfamiliar diagnostics retain a readable host fallback. */
export function localizeReason(code: string | undefined, message: string, t: Translate): string {
  const keys: Record<string, TextKey> = {
    active: 'reasonActive', busy: 'reasonBusy', 'host-loaded': 'reasonLoaded',
    'ambiguous-lifecycle': 'reasonLifecycle', 'release-failed': 'reasonRelease',
    'source-changed': 'reasonChanged', 'stale-preview': 'reasonChanged', 'preview-expired': 'previewExpired',
    'recovery-required': 'reasonRecovery', 'operation-interrupted': 'reasonInterrupted', 'purge-interrupted': 'reasonInterrupted',
    'already-pending': 'reasonPending', 'not-archived': 'reasonArchived',
    'session-missing': 'reasonMissing', 'missing-session': 'reasonMissing', 'session-not-found': 'reasonMissing',
    'dependent-session': 'reasonLineage', 'ambiguous-lineage': 'reasonLineage', 'ambiguous-workspace': 'reasonLineage',
    'unsafe-path': 'reasonPath', 'unsafe-lock': 'reasonPath', 'unknown-file': 'reasonPath', 'unknown-artifact': 'reasonPath',
    'path-conflict': 'reasonConflict', 'restore-conflict': 'reasonConflict', 'overlapping-targets': 'reasonOverlap',
    'store-busy': 'reasonStoreBusy',
  };
  const key = code ? keys[code] : undefined;
  return key ? t(key) : message;
}

function supportReason(status: SupportStatus, t: Translate): string {
  const message = status.reason;
  if (!message) return t('reasonCapabilities');
  if (message.startsWith('Only macOS')) return t('reasonPlatform');
  if (message.startsWith('DSH Desktop ') && message.includes(' is required;')) return t('reasonVersion', { required: SUPPORTED_DSH_VERSION, current: status.version });
  if (message.includes('official JSONL')) return t('reasonBackend');
  if (message.includes('Another DSH process')) return t('reasonStoreBusy');
  if (message.startsWith('Archive storage could not be initialized')) return t('reasonInitialization');
  if (message.includes('unavailable') || message.includes('incompatible')) return t('reasonCapabilities');
  return message;
}

export interface NativePrimitives {
  Button: React.ComponentType<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'outline' | 'toolbar'; size?: 'sm' | 'md'; icon?: React.ReactNode }>;
  Checkbox: React.ComponentType<{ checked: boolean; onChange(checked: boolean): void; label: string; disabled?: boolean; className?: string }>;
  Modal: React.ComponentType<{ open: boolean; onClose(): void; title: string; closeLabel: string; description?: string; footer?: React.ReactNode; children?: React.ReactNode; className?: string; contentClassName?: string }>;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function formatTime(timestamp: number): string {
  const language = typeof document === 'undefined' ? 'en' : document.documentElement.lang || 'en';
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(language) : '—';
}

function isoTime(timestamp: number): string | undefined {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function ErrorNotice({ error, t, onRefresh, onRetry, disabled, Button }: {
  error: ClientError; t: Translate; onRefresh(): void; onRetry(): void; disabled: boolean; Button: NativePrimitives['Button'];
}) {
  const message = error.uncertain ? t('unknown') : error.code === 'preview-expired' ? t('previewExpired') : error.code === 'list-failed' ? t('listFailure') : t('error');
  return <section className="dad-alert dad-error" role="alert">
    <p>{message}</p>
    {!error.uncertain && error.code !== 'preview-expired' && <details><summary>{t('errorDetails')}</summary><p>{localizeReason(error.code, error.message, t)}</p><code>{error.code}</code></details>}
    {error.uncertain && <div className="dad-actions"><Button size="sm" variant="outline" onClick={onRefresh} disabled={disabled}>{t('refresh')}</Button><Button size="sm" variant="outline" onClick={onRetry} disabled={disabled}>{t('retryRequest')}</Button></div>}
  </section>;
}

function ArchiveIcon({ trash = false }: { trash?: boolean }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{trash ? <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" /></> : <><path d="M4 5h16v4H4zM6 9v11h12V9M10 13h4" /></>}</svg>;
}

function EmptyState({ tab, t }: { tab: ArchiveTab; t: Translate }) {
  return <div className="dad-empty"><span className="dad-empty-icon"><ArchiveIcon trash={tab === 'trash'} /></span><strong>{t(tab === 'archived' ? 'noArchives' : 'noTrash')}</strong><p>{t(tab === 'archived' ? 'emptyArchivesHint' : 'emptyTrashHint')}</p></div>;
}

export function PreviewContent({ preview, t }: { preview: Preview; t: Translate }) {
  const members = preview.items.reduce((sum, item) => sum + item.memberIds.length, 0);
  return <div className="dad-preview">
    <div className="dad-summary"><strong>{t('previewCount', { n: preview.items.length })}</strong><span>{t('previewMembers', { n: members })}</span><span>{formatBytes(preview.items.reduce((sum, item) => sum + item.sizeBytes, 0))}</span></div>
    <ul className="dad-preview-list">
      {preview.items.map((item) => <li key={item.id}>
        <div className="dad-row-title"><strong>{item.title || item.sessionId}</strong><span className={`dad-pill dad-pill-${item.disposition}`}>{t(item.disposition === 'ready' ? 'ready' : item.disposition === 'pending' ? 'pendingPreview' : 'blocked')}</span></div>
        <div className="dad-meta"><span>{t('memberCount', { n: item.memberIds.length })}</span><span>{formatBytes(item.sizeBytes)}</span></div>
        {(item.disposition === 'pending' || item.message) && <p className="dad-item-reason">{item.disposition === 'pending' ? t('pendingHint') : localizeReason(item.code, item.message!, t)}</p>}
      </li>)}
    </ul>
    <section className={`dad-boundary${preview.action === 'purge' ? ' dad-boundary-danger' : ''}`}><span className="dad-boundary-icon"><ArchiveIcon trash={preview.action === 'purge'} /></span><div><strong>{t('scopeTitle')}</strong><p>{t('scope')}</p></div></section>
    <p className="dad-expiry">{t('expires', { time: formatTime(preview.expiresAt) })}</p>
  </div>;
}

export function ResultContent({ result, t, retry, disabled, Button }: {
  result: BatchResult; t: Translate; retry(id: string): void; disabled: boolean; Button: NativePrimitives['Button'];
}) {
  const hasProblems = result.counts.failed > 0 || result.counts.skipped > 0;
  return <details className="dad-results" aria-label={t('result')} open={hasProblems || undefined}>
    <summary><span className="dad-result-label">{t('result')}</span><span className={hasProblems ? 'dad-result-summary dad-result-attention' : 'dad-result-summary'} role="status">{t('resultSummary', result.counts)}</span><span className="dad-result-disclosure" aria-label={t('resultDetails')}>⌄</span></summary>
    <ul>{result.items.map((item) => <li key={item.id}>
      <div><strong>{item.title || item.id}</strong><span className={`dad-result-status dad-result-${item.status}`}>{t(`status.${item.status}` as `status.${ItemStatus}`)}</span>{item.message && <p>{localizeReason(item.code, item.message, t)}</p>}</div>
      {item.status === 'failed' && <Button size="sm" variant="outline" disabled={disabled} onClick={() => retry(item.id)}>{t('retry')}</Button>}
    </li>)}</ul>
  </details>;
}

export function ArchiveDialog({ controller, primitives, t }: {
  controller: ArchiveClientController; primitives: NativePrimitives; t: Translate;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  return <ArchiveDialogView state={state} controller={controller} primitives={primitives} t={t} />;
}

export function ArchiveDialogView({ state, controller, primitives, t }: {
  state: ClientState; controller: ArchiveClientController; primitives: NativePrimitives; t: Translate;
}) {
  const { Button, Checkbox, Modal } = primitives;
  const tabsId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const backAnchor = useRef<HTMLSpanElement>(null);
  const selected = visibleSelection(state);
  const selectedSet = new Set(selected);
  const eligibleIds = selectableIds(state);
  const pages = pageCount(state);
  const supported = state.overview?.support.supported === true;
  const uncertain = state.uncertainRequest;
  const locked = state.busy || state.loading || uncertain;
  const preview = state.preview;
  const previewId = preview?.id;
  const result = state.result ?? state.overview?.recentResults[0] ?? null;
  const actionTitle: Record<Action, TextKey> = { trash: 'moveTitle', restore: 'restoreTitle', purge: 'purgeTitle' };
  const actionDescription: Record<Action, TextKey> = { trash: 'moveDescription', restore: 'restoreDescription', purge: 'purgeDescription' };
  const actionConfirm: Record<Action, TextKey> = { trash: 'confirmTrash', restore: 'confirmRestore', purge: 'confirmPurge' };
  useEffect(() => {
    if (!state.open) return;
    if (previewId) backAnchor.current?.querySelector('button')?.focus();
    else tabRefs.current[state.tab === 'archived' ? 0 : 1]?.focus();
  }, [state.open, previewId, state.tab]);

  const changeTab = (tab: ArchiveTab, focus = false) => {
    controller.setTab(tab);
    if (focus) tabRefs.current[tab === 'archived' ? 0 : 1]?.focus();
  };
  const footer = preview ? <>
    <span ref={backAnchor}><Button variant="outline" disabled={state.busy || uncertain} onClick={controller.dismissPreview} data-modal-autofocus="">{t('back')}</Button></span>
    <Button variant={preview.action === 'purge' ? 'outline' : 'primary'} className={preview.action === 'purge' ? 'dad-danger' : undefined} disabled={locked || !supported || !canExecutePreview(preview)} onClick={() => { void controller.confirm(); }}>{t(actionConfirm[preview.action])}</Button>
  </> : <>
    <span className="dad-selection" aria-live="polite">{t('selected', { n: selected.length })}</span>
    <Button variant="outline" onClick={controller.close}>{t('close')}</Button>
    {state.tab === 'archived'
      ? <Button variant="primary" disabled={locked || !supported || selected.length === 0} onClick={() => { void controller.preview('trash'); }}>{t('moveSelected')}</Button>
      : <><Button variant="outline" disabled={locked || !supported || selected.length === 0} onClick={() => { void controller.preview('restore'); }}>{t('restoreSelected')}</Button><Button variant="outline" className="dad-danger" disabled={locked || !supported || selected.length === 0} onClick={() => { void controller.preview('purge'); }}>{t('purgeSelected')}</Button></>}
  </>;

  return <Modal open={state.open} onClose={controller.close} title={preview ? t(actionTitle[preview.action]) : t('title')} description={preview ? t(actionDescription[preview.action]) : t('intro')} closeLabel={t('close')} className="dad-dialog" contentClassName="dad-content" footer={footer}>
    <div className="dad-shell">
      {state.error && <ErrorNotice error={uncertain ? { ...state.error, uncertain: true } : state.error} t={t} onRefresh={() => { void controller.refresh(); }} onRetry={() => { void controller.retryUncertain(); }} disabled={state.busy || state.loading} Button={Button} />}
      {state.overview && !supported && <section className="dad-alert" role="status"><strong>{t('unsupported')}</strong><p>{supportReason(state.overview.support, t)}</p><small>{t('supportDetails', { version: state.overview.support.version, platform: state.overview.support.platform })}</small></section>}
      {state.busy && <p className="dad-progress" role="status">{t('working')}</p>}
      {preview ? <PreviewContent preview={preview} t={t} /> : <>
        <div className="dad-toolbar">
          <div className="dad-tabs" role="tablist" aria-label={t('title')} onKeyDown={(event) => {
            if (locked) return;
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            changeTab(event.key === 'Home' ? 'archived' : event.key === 'End' ? 'trash' : state.tab === 'archived' ? 'trash' : 'archived', true);
          }}>
            {(['archived', 'trash'] as const).map((tab, index) => <button key={tab} ref={(element) => { tabRefs.current[index] = element; }} type="button" role="tab" id={`${tabsId}-${tab}`} aria-controls={`${tabsId}-panel`} aria-selected={state.tab === tab} tabIndex={state.tab === tab ? 0 : -1} disabled={locked} data-modal-autofocus={state.tab === tab ? '' : undefined} onClick={() => changeTab(tab)}>{t(tab)}<span className="dad-count">{state.overview?.[tab].length ?? 0}</span></button>)}
          </div>
          <Button size="sm" variant="outline" disabled={state.loading || state.busy} onClick={() => { void controller.refresh(); }}>{t('refresh')}</Button>
        </div>
        <div className="dad-list-heading"><Checkbox checked={eligibleIds.length > 0 && selected.length === eligibleIds.length} disabled={locked || !supported || eligibleIds.length === 0} onChange={controller.selectAll} label={t('selectAll', { n: eligibleIds.length })} /><span className="dad-retention"><span aria-hidden="true">◷</span>{t('retention')}</span></div>
        <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${state.tab}`} aria-busy={state.loading} className="dad-list">
          {state.loading && <p role="status">{t('loading')}</p>}
          {!state.loading && state.overview && state.overview[state.tab].length === 0 && <EmptyState tab={state.tab} t={t} />}
          {state.tab === 'archived' ? pageItems(state.overview?.archived ?? [], state.page).map((item) => <div className="dad-row" key={item.id} data-selected={selectedSet.has(item.id)} data-pending={item.pending === true}>
            <div className="dad-row-main"><Checkbox checked={selectedSet.has(item.id)} disabled={locked || !supported || item.pending === true} onChange={() => controller.toggle(item.id)} label={item.title || item.id} /><div className="dad-meta"><span className="dad-workspace">{item.workspace || t('ungrouped')}</span><span>{formatBytes(item.sizeBytes)}</span>{item.descendantCount > 0 && <span className="dad-badge">{t('childCount', { n: item.descendantCount })}</span>}{item.pending && <span className="dad-badge dad-badge-pending">{t('pending')}</span>}</div>{item.pending && <p className="dad-pending">{t('pendingHint')}</p>}</div>
            {item.pending && <div className="dad-row-actions"><Button size="sm" variant="outline" disabled={locked || !supported} onClick={() => { void controller.reviewPending(item.id); }}>{t('reviewPending')}</Button><Button size="sm" variant="ghost" disabled={locked || !supported} onClick={() => { void controller.cancelPending([item.id]); }}>{t('cancelPending')}</Button></div>}
          </div>) : pageItems(state.overview?.trash ?? [], state.page).map((item) => <div className="dad-row" key={item.id} data-selected={selectedSet.has(item.id)}>
            <div className="dad-row-main"><Checkbox checked={selectedSet.has(item.id)} disabled={locked || !supported} onChange={() => controller.toggle(item.id)} label={item.title || item.sessionId} /><div className="dad-meta"><time dateTime={isoTime(item.trashedAt)}>{formatTime(item.trashedAt)}</time><span>{formatBytes(item.sizeBytes)}</span><span className="dad-badge">{t('memberCount', { n: item.memberCount })}</span></div></div>
          </div>)}
        </div>
        <div className="dad-list-foot"><p className="dad-hint">{t(state.tab === 'archived' ? 'archivedHint' : 'trashHint')}</p>{pages > 1 && <nav className="dad-pagination" aria-label={t('pages')}><Button size="sm" variant="ghost" disabled={locked || state.page === 0} onClick={() => controller.setPage(state.page - 1)}>{t('previousPage')}</Button><span>{t('pageNumber', { page: state.page + 1, pages })}</span><Button size="sm" variant="ghost" disabled={locked || state.page + 1 >= pages} onClick={() => controller.setPage(state.page + 1)}>{t('nextPage')}</Button></nav>}</div>
        {result && <ResultContent result={result} t={t} retry={(id) => { void controller.retryItem(id); }} disabled={locked || !supported} Button={Button} />}
      </>}
      {(state.busy || uncertain) && <p className="dad-muted">{t('operationContinues')}</p>}
    </div>
  </Modal>;
}

export const CLIENT_CSS = `
.dad-dialog{width:min(780px,calc(100vw - 32px));max-width:calc(100vw - 32px)}
.dad-content{max-height:min(65vh,540px);overflow:auto}
.dad-shell{--dad-border:var(--dsw-alias-border-l1,#8883);--dad-muted:var(--dsw-alias-label-secondary,GrayText);--dad-primary:var(--dsw-alias-label-primary,CanvasText);display:flex;flex-direction:column;gap:12px;min-width:0;color:var(--dad-primary);font-size:13px;line-height:1.5}
.dad-shell p,.dad-shell h3{margin:0}.dad-shell button{font:inherit}
.dad-toolbar,.dad-actions,.dad-row-title,.dad-meta,.dad-summary,.dad-list-heading,.dad-list-foot,.dad-pagination{display:flex;align-items:center;gap:10px}
.dad-toolbar{justify-content:space-between;gap:16px}
.dad-tabs{display:flex;gap:3px;padding:3px;border:1px solid var(--dad-border);border-radius:11px;background:var(--dsw-alias-bg-layer-1,#8881)}
.dad-tabs button{display:flex;align-items:center;gap:8px;border:0;background:transparent;color:var(--dad-muted);padding:7px 13px;font-size:13px;font-weight:500;border-radius:8px;cursor:pointer}
.dad-tabs button[aria-selected=true]{color:var(--dad-primary);background:var(--dsw-alias-bg-base,Canvas);box-shadow:0 1px 3px #0001}
.dad-tabs button:focus-visible,.dad-row:focus-within{outline:2px solid var(--dsw-alias-button-primary-bg,#2878e0);outline-offset:2px}
.dad-tabs button:disabled{cursor:default;opacity:.55}.dad-count{display:inline-flex;align-items:center;justify-content:center;min-width:19px;height:18px;padding:0 4px;border-radius:5px;background:color-mix(in srgb,var(--dad-primary) 6%,transparent);font-size:10px;font-weight:600;font-variant-numeric:tabular-nums}
.dad-list-heading{justify-content:space-between;gap:12px;padding:1px 2px;color:var(--dad-muted);font-size:12px}.dad-retention{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;font-size:11px}.dad-retention>span{font-size:15px;line-height:1}
.dad-list{display:flex;flex-direction:column;gap:7px;min-height:70px;max-height:290px;overflow:auto;padding:3px 3px 4px;scrollbar-gutter:stable}
.dad-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:11px 12px;border:1px solid var(--dad-border);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#88805);transition:border-color .15s,background .15s}
.dad-row[data-selected=true]{border-color:color-mix(in srgb,var(--dad-primary) 32%,transparent);background:color-mix(in srgb,var(--dad-primary) 6%,transparent)}
.dad-row[data-pending=true]{border-style:dashed}.dad-row-main{flex:1;min-width:0}.dad-row-main>label{min-width:0;align-items:flex-start;font-size:13px;font-weight:500}.dad-row-main>label>span{overflow-wrap:anywhere}
.dad-meta{gap:5px 10px;flex-wrap:wrap;margin-top:5px;padding-left:25px;color:var(--dad-muted);font-size:11px;line-height:1.5}.dad-meta>span,.dad-meta>time{overflow-wrap:anywhere}.dad-workspace{max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dad-badge{padding:1px 6px;border-radius:5px;background:color-mix(in srgb,var(--dad-primary) 5%,transparent);font-size:10px}.dad-badge-pending{border:1px solid var(--dad-border);background:transparent}
.dad-pending{margin:6px 0 0 25px!important;color:var(--dad-muted);font-size:11px;line-height:1.5}.dad-row-actions{display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0;margin-top:1px}.dad-row-actions>button{max-width:190px;white-space:normal;text-align:right}
.dad-list-foot{align-items:flex-start;justify-content:space-between;gap:12px}.dad-hint,.dad-expiry{color:var(--dad-muted);font-size:11px;line-height:1.5}.dad-hint{padding:1px 2px}.dad-pagination{flex-shrink:0;gap:5px;font-size:11px;color:var(--dad-muted)}.dad-pagination button{padding:1px 5px;min-height:22px}.dad-pagination>span{font-variant-numeric:tabular-nums;white-space:nowrap}
.dad-selection{margin-right:auto;font-size:12px;color:var(--dsw-alias-label-secondary,GrayText)}
.dad-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;min-height:180px;padding:25px 18px;text-align:center;border:1px dashed var(--dad-border);border-radius:12px;color:var(--dad-muted)}.dad-empty strong{color:var(--dad-primary);font-size:13px;font-weight:500}.dad-empty p{max-width:340px;font-size:12px}.dad-empty-icon{display:flex;align-items:center;justify-content:center;width:42px;height:42px;margin-bottom:5px;border:1px solid var(--dad-border);border-radius:13px;background:var(--dsw-alias-bg-layer-1,#8881)}
.dad-alert{padding:10px 12px;border:1px solid var(--dad-border);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#8881);font-size:12px;line-height:1.6}.dad-alert p+p{margin-top:5px}.dad-alert details{margin-top:5px}.dad-alert code{font-size:11px;overflow-wrap:anywhere}
.dad-error{border-color:var(--dsw-alias-status-error,#bd3d3d)}.dad-actions{margin-top:8px;flex-wrap:wrap}.dad-progress{font-size:12px;padding:3px 0;color:var(--dad-muted)}.dad-muted{color:var(--dad-muted);font-size:12px;line-height:1.6}
.dad-summary{gap:8px;flex-wrap:wrap;padding:0 1px;font-size:12px}.dad-summary>strong{font-weight:600}.dad-summary>span{color:var(--dad-muted)}.dad-summary>span:before{content:'·';margin-right:8px;opacity:.6}
.dad-preview-list,.dad-results ul{list-style:none;padding:0;margin:0}.dad-preview-list{display:flex;flex-direction:column;gap:7px;max-height:250px;overflow:auto;margin-top:12px;padding:2px 2px 3px}.dad-preview-list li{padding:12px;border:1px solid var(--dad-border);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#88805)}.dad-preview-list .dad-meta{padding-left:0}.dad-row-title{justify-content:space-between;align-items:flex-start}.dad-row-title strong{font-size:13px;font-weight:500;overflow-wrap:anywhere}
.dad-pill{flex-shrink:0;font-size:10px;white-space:nowrap;border:1px solid var(--dad-border);border-radius:6px;padding:2px 7px;color:var(--dad-muted)}.dad-pill-ready{background:color-mix(in srgb,var(--dad-primary) 5%,transparent)}.dad-pill-blocked,.dad-result-attention{color:var(--dsw-alias-status-error,#bd3d3d)}.dad-item-reason{font-size:11px;line-height:1.5;margin-top:7px!important;color:var(--dad-muted);overflow-wrap:anywhere}
.dad-boundary{display:flex;align-items:flex-start;gap:10px;margin:13px 2px 10px;padding:11px 12px;border:1px solid var(--dad-border);border-radius:10px;font-size:11px;line-height:1.6;color:var(--dad-muted)}.dad-boundary-icon{display:flex;flex-shrink:0;margin-top:1px}.dad-boundary strong{display:block;margin-bottom:3px;font-size:11px;font-weight:600;color:var(--dad-primary)}.dad-boundary-danger{border-color:color-mix(in srgb,var(--dsw-alias-status-error,#bd3d3d) 30%,transparent)}.dad-boundary-danger .dad-boundary-icon{color:var(--dsw-alias-status-error,#bd3d3d)}.dad-expiry{padding:0 3px}
.dad-danger{color:var(--dsw-alias-status-error,#bd3d3d)!important}.dad-results{border:1px solid var(--dad-border);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#88805);font-size:11px}.dad-results summary{display:flex;align-items:center;gap:10px;list-style:none;padding:10px 12px;cursor:pointer}.dad-results summary::-webkit-details-marker{display:none}.dad-results summary:focus-visible{outline:2px solid var(--dsw-alias-button-primary-bg,#2878e0);outline-offset:2px;border-radius:9px}.dad-result-label{font-weight:500;white-space:nowrap}.dad-result-summary{flex:1;color:var(--dad-muted);font-variant-numeric:tabular-nums}.dad-result-disclosure{font-size:16px;line-height:1;color:var(--dad-muted);transition:transform .15s}.dad-results[open] .dad-result-disclosure{transform:rotate(180deg)}.dad-results[open] summary{border-bottom:1px solid var(--dad-border)}.dad-results ul{padding:0 12px;max-height:190px;overflow:auto}.dad-results li{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid var(--dad-border)}.dad-results li:last-child{border-bottom:0}.dad-results li>div{min-width:0}.dad-results li strong{font-weight:500;overflow-wrap:anywhere}.dad-result-status{display:inline-block;margin-left:8px;font-size:10px;color:var(--dad-muted)}.dad-result-failed{color:var(--dsw-alias-status-error,#bd3d3d)}.dad-results li p{font-size:11px;line-height:1.5;margin-top:4px;overflow-wrap:anywhere}
@media(prefers-reduced-motion:reduce){.dad-row,.dad-result-disclosure{transition:none}}
@media(max-width:560px){.dad-dialog{width:calc(100vw - 20px);max-width:calc(100vw - 20px)}.dad-content{max-height:65vh}.dad-toolbar{gap:8px}.dad-tabs button{padding:6px 9px}.dad-row{padding:10px;gap:8px}.dad-row-title{flex-wrap:wrap;gap:6px}.dad-list-foot{flex-direction:column;gap:6px}.dad-retention{font-size:10px}.dad-results summary{flex-wrap:wrap;gap:4px 9px}.dad-result-summary{flex-basis:75%}.dad-result-disclosure{margin-left:auto}.dad-workspace{max-width:100%}}
@media(max-width:560px){.dad-row[data-pending=true]{flex-wrap:wrap}.dad-row-actions{width:100%;flex-direction:row;flex-wrap:wrap;justify-content:flex-end}.dad-row-actions>button{max-width:100%}}
`;
