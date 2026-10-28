import React, { useEffect, useId, useRef, useSyncExternalStore } from 'react';
import type { Action, BatchResult, ItemStatus, Preview } from './contracts.js';
import { ArchiveClientController, canExecutePreview, selectableIds, visibleSelection, type ArchiveTab, type ClientError, type ClientState } from './client-state.js';

export const CLIENT_NAMESPACE = 'qwqbig.archiveDelete';
export const en = {
  title: 'Archive cleanup', manage: 'Manage archives and trash', menuTrash: 'Move to trash',
  archived: 'Archived', trash: 'Trash', close: 'Close', refresh: 'Refresh', cancel: 'Cancel', back: 'Back',
  loading: 'Loading…', working: 'Processing the selected records…',
  intro: 'Move archived conversations to a recoverable trash. Nothing expires automatically.',
  scope: 'Session logs and their dedicated subagent logs are included. Shared attachments, spill files, project files and other plugins’ caches are retained.',
  noArchives: 'No archived conversations.', noTrash: 'The trash is empty.',
  selectAll: 'Select all available records ({n})', selected: '{n} selected',
  moveSelected: 'Move selected to trash', restoreSelected: 'Restore selected', purgeSelected: 'Delete permanently',
  moveTitle: 'Move these conversations to trash?', restoreTitle: 'Restore these conversations?', purgeTitle: 'Permanently delete these conversations?',
  moveDescription: 'Review every target before confirming. Idle conversations still held by DSH can wait for the next start.',
  restoreDescription: 'Restore the original logs in their archived state. A missing workspace becomes Ungrouped; existing paths will never be overwritten.',
  purgeDescription: 'This removes the selected trash records and their session logs from this machine. It cannot be undone.',
  confirmTrash: 'Confirm move to trash', confirmRestore: 'Confirm restore', confirmPurge: 'Confirm permanent deletion',
  previewExpired: 'This preview expired. Go back and review your selection again.',
  previewEmpty: 'No eligible records remain. Go back and refresh the list.',
  archivedHint: 'Only archived conversations are eligible. Running work and uncertain relationships are protected.',
  trashHint: 'Restored conversations stay archived. The trash is retained until you choose to clear it.',
  pending: 'Waiting to move after restart', pendingHint: 'The logs remain in their original location until DSH releases them. No disk space has been freed yet.',
  cancelPending: 'Cancel pending move', pendingCancelled: 'Pending move cancelled',
  childCount: '{n} dedicated subagent conversation(s)', memberCount: '{n} conversation(s)',
  ready: 'Ready', blocked: 'Skipped', pendingPreview: 'Will wait for the next start',
  previewCount: '{n} selected target(s)', previewMembers: '{n} total conversation(s), including dedicated subagents',
  previewSize: 'Session log size: {size}', expires: 'Confirmation is valid until {time}.',
  result: 'Latest operation', resultSummary: '{succeeded} succeeded · {pending} pending · {skipped} skipped · {failed} failed',
  retry: 'Review and retry', retryRequest: 'Retry the same request', unknown: 'The request outcome is unknown. Refresh to check the host, or retry the same request without creating a second operation.',
  error: 'The operation could not be completed.', unsupported: 'Data operations are unavailable on this host.',
  supportDetails: 'Host: {version} · {platform}', errorDetails: 'Details', ungrouped: 'Ungrouped',
  'status.moved': 'Moved to trash', 'status.pending': 'Pending restart', 'status.restored': 'Restored',
  'status.purged': 'Permanently deleted', 'status.cancelled': 'Cancelled', 'status.skipped': 'Skipped', 'status.failed': 'Failed',
  checking: 'Checking the selected records…', operationContinues: 'Closing this window does not cancel an operation already sent to DSH.',
  listFailure: 'Unable to read the current records. Refresh to try again.',
} as const;
export type TextKey = keyof typeof en;
export type Translate = (key: TextKey, values?: Record<string, string | number>) => string;
export const zh: Record<TextKey, string> = {
  title: '归档清理', manage: '管理归档与回收站', menuTrash: '移入回收站',
  archived: '已归档', trash: '回收站', close: '关闭', refresh: '刷新', cancel: '取消', back: '返回',
  loading: '正在读取…', working: '正在处理选中的记录…',
  intro: '将已归档会话移入可恢复的回收站，不会自动过期清除。',
  scope: '处理范围包含会话日志及其专属子代理日志。共享附件、spill 文件、项目文件和其他插件缓存会保留。',
  noArchives: '没有已归档会话。', noTrash: '回收站为空。',
  selectAll: '全选可操作记录（{n}）', selected: '已选择 {n} 项',
  moveSelected: '将所选移入回收站', restoreSelected: '恢复所选', purgeSelected: '永久清除',
  moveTitle: '将这些会话移入回收站？', restoreTitle: '恢复这些会话？', purgeTitle: '永久清除这些会话？',
  moveDescription: '请核对每个目标。闲置但仍被 DSH 占用的会话，可以等待下次启动后处理。',
  restoreDescription: '恢复原始日志并保持已归档状态。原工作区不存在时归入“未分组”，不会覆盖已有路径。',
  purgeDescription: '将从本机移除选中的回收站记录及其会话日志，此操作无法撤销。',
  confirmTrash: '确认移入回收站', confirmRestore: '确认恢复', confirmPurge: '确认永久清除',
  previewExpired: '预览已过期，请返回并重新核对目标。',
  previewEmpty: '没有可操作记录，请返回并刷新列表。',
  archivedHint: '仅支持已归档会话；正在运行的工作和关联不明的记录会受到保护。',
  trashHint: '恢复后会话仍为已归档状态。回收站内容会保留，直到你主动清除。',
  pending: '待重启后移入回收站', pendingHint: '日志仍在原位置，DSH 释放占用后才会移动，目前尚未释放磁盘空间。',
  cancelPending: '取消待处理', pendingCancelled: '已取消待处理',
  childCount: '{n} 个专属子代理会话', memberCount: '{n} 个会话',
  ready: '可执行', blocked: '跳过', pendingPreview: '将等待下次启动',
  previewCount: '已选择 {n} 个目标', previewMembers: '合计 {n} 个会话（包含专属子代理）',
  previewSize: '会话日志大小：{size}', expires: '本次确认在 {time} 前有效。',
  result: '最近操作', resultSummary: '成功 {succeeded} · 待处理 {pending} · 跳过 {skipped} · 失败 {failed}',
  retry: '重新核对并重试', retryRequest: '重试同一次请求', unknown: '请求结果未知。可以刷新核对宿主状态，或重试同一次请求，不会创建第二次操作。',
  error: '操作未能完成。', unsupported: '当前宿主暂不支持数据操作。',
  supportDetails: '宿主：{version} · {platform}', errorDetails: '详情', ungrouped: '未分组',
  'status.moved': '已移入回收站', 'status.pending': '待重启处理', 'status.restored': '已恢复',
  'status.purged': '已永久清除', 'status.cancelled': '已取消', 'status.skipped': '已跳过', 'status.failed': '失败',
  checking: '正在核对所选记录…', operationContinues: '关闭此窗口不会取消已经发送给 DSH 的操作。',
  listFailure: '无法读取当前记录，请刷新重试。',
};

export function translator(language: 'en' | 'zh'): Translate {
  const dictionary = language === 'zh' ? zh : en;
  return (key, values = {}) => dictionary[key].replace(/\{([^}]+)\}/g, (match, name: string) => String(values[name] ?? match));
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
    {!error.uncertain && error.code !== 'preview-expired' && <details><summary>{t('errorDetails')}</summary><p>{error.message}</p><code>{error.code}</code></details>}
    {error.uncertain && <div className="dad-actions"><Button size="sm" variant="outline" onClick={onRefresh} disabled={disabled}>{t('refresh')}</Button><Button size="sm" variant="outline" onClick={onRetry} disabled={disabled}>{t('retryRequest')}</Button></div>}
  </section>;
}

export function PreviewContent({ preview, t }: { preview: Preview; t: Translate }) {
  const members = preview.items.reduce((sum, item) => sum + item.memberIds.length, 0);
  return <div className="dad-preview">
    <div className="dad-summary"><strong>{t('previewCount', { n: preview.items.length })}</strong><span>{t('previewMembers', { n: members })}</span></div>
    <ul className="dad-preview-list">
      {preview.items.map((item) => <li key={item.id}>
        <div className="dad-row-title"><strong>{item.title || item.sessionId}</strong><span className={`dad-pill dad-pill-${item.disposition}`}>{t(item.disposition === 'ready' ? 'ready' : item.disposition === 'pending' ? 'pendingPreview' : 'blocked')}</span></div>
        <div className="dad-meta"><span>{t('memberCount', { n: item.memberIds.length })}</span><span>{formatBytes(item.sizeBytes)}</span></div>
        {item.message && <p className="dad-item-reason">{item.message}</p>}
      </li>)}
    </ul>
    <p className="dad-boundary">{t('scope')}</p>
    {preview.action === 'trash' && preview.items.some((item) => item.disposition === 'pending') && <p className="dad-alert">{t('pendingHint')}</p>}
    <p className="dad-muted">{t('expires', { time: formatTime(preview.expiresAt) })}</p>
  </div>;
}

export function ResultContent({ result, t, retry, disabled, Button }: {
  result: BatchResult; t: Translate; retry(id: string): void; disabled: boolean; Button: NativePrimitives['Button'];
}) {
  return <section className="dad-results" aria-label={t('result')}>
    <h3>{t('result')}</h3>
    <p role="status">{t('resultSummary', result.counts)}</p>
    <ul>{result.items.map((item) => <li key={item.id}>
      <div><strong>{item.title || item.id}</strong><span className={`dad-result-status dad-result-${item.status}`}>{t(`status.${item.status}` as `status.${ItemStatus}`)}</span>{item.message && <p>{item.message}</p>}</div>
      {item.status === 'failed' && <Button size="sm" variant="outline" disabled={disabled} onClick={() => retry(item.id)}>{t('retry')}</Button>}
    </li>)}</ul>
  </section>;
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
      {state.overview && !supported && <section className="dad-alert" role="status"><strong>{t('unsupported')}</strong><p>{state.overview.support.reason}</p><small>{t('supportDetails', { version: state.overview.support.version, platform: state.overview.support.platform })}</small></section>}
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
        <p className="dad-muted">{t(state.tab === 'archived' ? 'archivedHint' : 'trashHint')}</p>
        <Checkbox checked={eligibleIds.length > 0 && selected.length === eligibleIds.length} disabled={locked || !supported || eligibleIds.length === 0} onChange={controller.selectAll} label={t('selectAll', { n: eligibleIds.length })} />
        <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${state.tab}`} aria-busy={state.loading} className="dad-list">
          {state.loading && <p role="status">{t('loading')}</p>}
          {!state.loading && state.overview && state.overview[state.tab].length === 0 && <p className="dad-empty">{t(state.tab === 'archived' ? 'noArchives' : 'noTrash')}</p>}
          {state.tab === 'archived' ? state.overview?.archived.map((item) => <div className="dad-row" key={item.id}>
            <div className="dad-row-main"><Checkbox checked={selectedSet.has(item.id)} disabled={locked || !supported || item.pending === true} onChange={() => controller.toggle(item.id)} label={item.title || item.id} /><div className="dad-meta"><span>{item.workspace || t('ungrouped')}</span><span>{formatBytes(item.sizeBytes)}</span>{item.descendantCount > 0 && <span>{t('childCount', { n: item.descendantCount })}</span>}</div>{item.pending && <p className="dad-pending"><strong>{t('pending')}</strong><span>{t('pendingHint')}</span>{item.pendingReason && <span>{item.pendingReason}</span>}</p>}</div>
            {item.pending && <Button size="sm" variant="outline" disabled={locked || !supported} onClick={() => { void controller.cancelPending([item.id]); }}>{t('cancelPending')}</Button>}
          </div>) : state.overview?.trash.map((item) => <div className="dad-row" key={item.id}>
            <div className="dad-row-main"><Checkbox checked={selectedSet.has(item.id)} disabled={locked || !supported} onChange={() => controller.toggle(item.id)} label={item.title || item.sessionId} /><div className="dad-meta"><time dateTime={isoTime(item.trashedAt)}>{formatTime(item.trashedAt)}</time><span>{formatBytes(item.sizeBytes)}</span><span>{t('memberCount', { n: item.memberCount })}</span></div></div>
          </div>)}
        </div>
        {result && <ResultContent result={result} t={t} retry={(id) => { void controller.retryItem(id); }} disabled={locked || !supported} Button={Button} />}
      </>}
      {(state.busy || uncertain) && <p className="dad-muted">{t('operationContinues')}</p>}
    </div>
  </Modal>;
}

export const CLIENT_CSS = `
.dad-dialog{width:min(880px,calc(100vw - 32px));max-width:calc(100vw - 32px)}
.dad-content{max-height:min(80vh,780px);overflow:auto}
.dad-shell{display:flex;flex-direction:column;gap:14px;min-width:0;color:var(--dsw-alias-label-primary,CanvasText)}
.dad-shell p,.dad-shell h3{margin:0}.dad-shell h3{font-size:13px;font-weight:600}
.dad-toolbar,.dad-actions,.dad-row-title,.dad-meta,.dad-summary{display:flex;align-items:center;gap:10px}
.dad-toolbar{justify-content:space-between}.dad-tabs{display:flex;gap:4px;padding:3px;border-radius:12px;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.08))}
.dad-tabs button{display:flex;align-items:center;gap:7px;border:0;background:transparent;color:var(--dsw-alias-label-secondary,GrayText);padding:7px 11px;font:inherit;border-radius:9px;cursor:pointer}
.dad-tabs button[aria-selected=true]{color:var(--dsw-alias-label-primary,CanvasText);background:var(--dsw-alias-bg-base,Canvas);box-shadow:0 1px 3px #0001}
.dad-tabs button:focus-visible,.dad-actions button:focus-visible{outline:2px solid var(--dsw-alias-button-primary-bg,#2878e0);outline-offset:2px}
.dad-tabs button:disabled{cursor:default;opacity:.55}.dad-count{font-size:11px;opacity:.7}.dad-muted,.dad-meta{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary,GrayText)}
.dad-meta{gap:5px 12px;flex-wrap:wrap;margin-top:4px}.dad-meta>span:first-child{overflow-wrap:anywhere}.dad-selection{margin-right:auto;font-size:12px;color:var(--dsw-alias-label-secondary,GrayText)}
.dad-list{min-height:80px;max-height:360px;overflow:auto;border-top:1px solid var(--dsw-alias-border-l1,#8883);border-bottom:1px solid var(--dsw-alias-border-l1,#8883)}
.dad-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:12px 2px;border-bottom:1px solid var(--dsw-alias-border-l1,#8882)}.dad-row:last-child{border-bottom:0}.dad-row-main{flex:1;min-width:0}.dad-row-main>label{min-width:0;align-items:flex-start}.dad-row-main>label>span{overflow-wrap:anywhere}
.dad-pending{display:flex;flex-direction:column;gap:3px;margin-top:7px!important;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary,GrayText)}.dad-pending strong{color:var(--dsw-alias-label-primary,CanvasText)}
.dad-empty{padding:30px 12px;text-align:center;color:var(--dsw-alias-label-secondary,GrayText)}
.dad-alert{padding:11px 13px;border:1px solid var(--dsw-alias-border-l1,#8884);border-radius:12px;background:var(--dsw-alias-bg-layer-1,#8881);font-size:12px;line-height:1.65}.dad-alert p+p{margin-top:5px}.dad-alert details{margin-top:5px}.dad-alert code{font-size:11px;overflow-wrap:anywhere}
.dad-error{border-color:var(--dsw-alias-status-error,#bd3d3d);color:var(--dsw-alias-label-primary,CanvasText)}.dad-actions{margin-top:8px;flex-wrap:wrap}.dad-actions button{font:inherit;color:inherit;background:transparent;border:1px solid var(--dsw-alias-border-l1,#8885);border-radius:7px;padding:4px 8px;cursor:pointer}
.dad-progress{font-size:12px;padding:8px 0;color:var(--dsw-alias-label-secondary,GrayText)}
.dad-preview-list,.dad-results ul{list-style:none;padding:0;margin:0}.dad-preview-list{max-height:320px;overflow:auto;border:1px solid var(--dsw-alias-border-l1,#8883);border-radius:12px;margin-top:12px}.dad-preview-list li{padding:12px;border-bottom:1px solid var(--dsw-alias-border-l1,#8883)}.dad-preview-list li:last-child{border-bottom:0}.dad-row-title{justify-content:space-between;align-items:flex-start}.dad-row-title strong{font-size:13px;overflow-wrap:anywhere}.dad-summary{align-items:flex-start;flex-direction:column;gap:4px;font-size:12px}.dad-summary>span{color:var(--dsw-alias-label-secondary,GrayText)}
.dad-pill{font-size:11px;white-space:nowrap;border:1px solid var(--dsw-alias-border-l1,#8883);border-radius:99px;padding:1px 7px}.dad-pill-blocked,.dad-result-failed{color:var(--dsw-alias-status-error,#bd3d3d)}.dad-item-reason{font-size:12px;line-height:1.6;margin-top:7px!important;overflow-wrap:anywhere}.dad-boundary{font-size:12px;line-height:1.7;margin:14px 0!important;color:var(--dsw-alias-label-secondary,GrayText)}
.dad-danger{color:var(--dsw-alias-status-error,#bd3d3d)!important}.dad-results{border-top:1px solid var(--dsw-alias-border-l1,#8883);padding-top:12px}.dad-results>p{font-size:12px;line-height:1.7;margin-top:5px}.dad-results li{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;font-size:12px;margin-top:8px}.dad-results li strong{font-weight:500;overflow-wrap:anywhere}.dad-result-status{margin-left:9px;color:var(--dsw-alias-label-secondary,GrayText)}.dad-results li p{font-size:12px;line-height:1.6;margin-top:3px;overflow-wrap:anywhere}
@media(max-width:560px){.dad-toolbar{align-items:flex-start}.dad-row{flex-direction:column}.dad-row-title{flex-direction:column}.dad-dialog{width:calc(100vw - 20px);max-width:calc(100vw - 20px)}}
`;
