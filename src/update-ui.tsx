import React, { useSyncExternalStore } from 'react';
import type { NativePrimitives } from './client-ui.js';
import { UpdateClientController } from './update-client.js';

export const updateEn = {
  updateTitle: 'Plugin updates', updateCurrent: 'Running {version}', updateInstalled: 'Installed {version}', updateCheck: 'Check for updates', updateChecking: 'Checking GitHub…',
  updateAutomatic: 'Checks GitHub daily while DSH is running. Installation always requires your confirmation.',
  updateCurrentStatus: 'This version is up to date.', updateUnknownStatus: 'The latest version has not been checked.',
  updateAvailable: '{version} is available', updateIncompatible: 'No verified update is available for this DSH version.',
  updateChecked: 'Last checked: {time}', updateReview: 'Review update', updateRelease: 'Release details', updateNotes: 'What changed',
  updateConfirmTitle: 'Install version {version}?', updateConfirm: 'Confirm upgrade', updateCancel: 'Cancel',
  updateScope: 'This replaces this plugin in the current DSH profile. Archive work pauses during installation; your conversations and trash are retained. DSH may require a full quit and reopen to load the new version.',
  updateInstalling: 'Verifying and installing the confirmed update…', updateRestart: 'The new version is installed. Fully quit DSH and reopen it to finish loading it.',
  updateDone: 'The new version is installed and active.', updateFailed: 'The update did not complete.', updateInterrupted: 'The previous update was interrupted. Check again before retrying.',
  updateUnknownOutcome: 'The installation outcome is uncertain. Check its status or retry the same request. If it remains uncertain, fully quit DSH and reopen it to reconcile.', updateReconcile: 'Check installation status', updateRetry: 'Retry the same request',
  updateUnavailable: 'The native update manager is unavailable in this profile.', updateBusy: 'Finish the current operation before upgrading.',
  updateErrorNetwork: 'GitHub could not be reached. Your installed version is unchanged; try checking again later.',
  updateErrorService: 'The plugin service could not be reached. Check that the plugin is loaded, then try again.',
  updateErrorRate: 'GitHub has limited update requests. Try checking again later.', updateErrorChanged: 'The release changed. Check again and review the new details.',
  updateErrorIntegrity: 'The release package or metadata could not be verified. Nothing will be installed from this confirmation.',
  updateErrorState: 'Update records or the cached package need attention. Check host diagnostics before retrying.',
  updateErrorHost: 'The native manager could not complete this upgrade. Check host diagnostics and the installed version.',
  updateErrorGeneric: 'The update could not be completed. Check again or inspect the host diagnostics.',
  updateDetails: 'Diagnostic code', updateNoNotes: 'This release has no notes.', updateWaiting: 'Archive changes are paused for this plugin update.',
} as const;
export const updateZh: Record<keyof typeof updateEn, string> = {
  updateTitle: '插件更新', updateCurrent: '正在运行 {version}', updateInstalled: '已安装 {version}', updateCheck: '检查更新', updateChecking: '正在检查 GitHub…',
  updateAutomatic: 'DSH 运行期间每天检查 GitHub，安装始终需要你确认。',
  updateCurrentStatus: '当前版本已是最新。', updateUnknownStatus: '尚未检查最新版本。',
  updateAvailable: '发现新版本 {version}', updateIncompatible: '暂无已验证兼容当前 DSH 的更新。',
  updateChecked: '上次检查：{time}', updateReview: '查看并升级', updateRelease: '发行详情', updateNotes: '更新内容',
  updateConfirmTitle: '安装版本 {version}？', updateConfirm: '确认升级', updateCancel: '取消',
  updateScope: '替换当前 DSH profile 中的本插件，安装期间暂停归档操作，会话与回收站会保留。DSH 可能需要完整退出并重新打开，才能加载新版本。',
  updateInstalling: '正在校验并安装已确认的更新…', updateRestart: '新版本已安装，请完整退出 DSH 并重新打开，完成新版加载。',
  updateDone: '新版本已安装并生效。', updateFailed: '升级未完成。', updateInterrupted: '上次升级中断，请重新检查后再试。',
  updateUnknownOutcome: '安装结果尚无法确认，请核对状态或重试同一次请求；若仍无法确认，请完整退出 DSH 并重新打开以核对记录。', updateReconcile: '核对安装状态', updateRetry: '重试同一次请求',
  updateUnavailable: '当前 profile 的原生更新管理器不可用。', updateBusy: '请先完成当前操作，再升级插件。',
  updateErrorNetwork: '无法连接 GitHub，已安装版本保持不变，请稍后重新检查。',
  updateErrorService: '无法连接插件服务，请确认插件已加载后再试。',
  updateErrorRate: 'GitHub 限制了更新请求，请稍后重新检查。', updateErrorChanged: '发行内容已变化，请重新检查并核对新版说明。',
  updateErrorIntegrity: '发行包或元数据未通过校验，本次确认不会安装它。',
  updateErrorState: '更新记录或缓存安装包需要处理，请查看宿主诊断后再试。',
  updateErrorHost: '原生管理器未完成此次升级，请核对宿主诊断与已安装版本。',
  updateErrorGeneric: '更新未能完成，请重新检查或查看宿主诊断。',
  updateDetails: '诊断代码', updateNoNotes: '此版本未提供更新说明。', updateWaiting: '插件升级期间暂停归档变更。',
};
type Key = keyof typeof updateEn;
type T = (key: Key, values?: Record<string, string | number>) => string;
function reason(code: string, t: T): string {
  if (code === 'update-service-unavailable') return t('updateErrorService');
  if (/rate/.test(code)) return t('updateErrorRate');
  if (/network|timeout|unreachable/.test(code)) return t('updateErrorNetwork');
  if (/changed|stale/.test(code)) return t('updateErrorChanged');
  if (/integrity|checksum|package-invalid|metadata|unsafe-archive|response-too-large|redirect-rejected/.test(code)) return t('updateErrorIntegrity');
  if (/state|cache|path/.test(code)) return t('updateErrorState');
  if (/unavailable/.test(code)) return t('updateUnavailable');
  if (/host|manager|install|activation|build/.test(code)) return t('updateErrorHost');
  if (code === 'update-outcome-unknown') return t('updateUnknownOutcome');
  return t('updateErrorGeneric');
}
export function UpdateCard({ controller, Button, t, archiveBusy = false }: {
  controller: UpdateClientController; Button: NativePrimitives['Button']; t: T; archiveBusy?: boolean;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  if (!controller.available) return null;
  const data = state.data; const installation = data?.installation;
  const restart = data && data.currentVersion !== data.installedVersion || installation?.status === 'restart-required';
  const busy = archiveBusy || state.checking || state.installing || state.uncertain;
  const canReview = data?.availability === 'available' && data.canInstall && !state.error && !restart && installation?.status !== 'unknown' && installation?.status !== 'installing';
  const status = state.installing || installation?.status === 'installing' ? t('updateInstalling') : restart ? t('updateRestart')
    : state.uncertain || installation?.status === 'unknown' ? t('updateUnknownOutcome') : installation?.status === 'failed' ? t('updateFailed')
    : installation?.status === 'interrupted' ? t('updateInterrupted') : installation?.status === 'installed' ? t('updateDone')
    : data?.availability === 'available' ? t('updateAvailable', { version: data.candidate!.version })
    : data?.availability === 'current' ? t('updateCurrentStatus') : data?.availability === 'incompatible' ? t('updateIncompatible') : t('updateUnknownStatus');
  const code = state.error ?? (data?.availability === 'error' ? data.code : installation?.code);
  return <section className="dad-update" aria-label={t('updateTitle')} aria-busy={state.installing || state.checking}>
    <div className="dad-update-heading"><div><strong>{t('updateTitle')}</strong>{data && <small>{t('updateCurrent', { version: data.currentVersion })}{data.currentVersion !== data.installedVersion && <> · {t('updateInstalled', { version: data.installedVersion })}</>}</small>}</div>
      <Button size="sm" variant="outline" disabled={state.installing || state.checking} onClick={() => { void controller.check(true); }}>{t(state.checking ? 'updateChecking' : state.uncertain ? 'updateReconcile' : 'updateCheck')}</Button></div>
    <p role="status" className={restart || state.uncertain ? 'dad-update-attention' : ''}>{status}</p>
    {code && <div role="alert"><p>{reason(code, t)}</p><details><summary>{t('updateDetails')}</summary><code>{code}</code></details></div>}
    {data?.candidate && <div className="dad-update-actions"><a href={data.candidate.releaseUrl} target="_blank" rel="noreferrer">{t('updateRelease')}</a>{canReview && !state.reviewId && <Button size="sm" variant="primary" disabled={busy} onClick={controller.review}>{t('updateReview')}</Button>}</div>}
    {state.reviewId && data?.candidate && <div className="dad-update-review"><strong>{t('updateConfirmTitle', { version: data.candidate.version })}</strong><details open><summary>{t('updateNotes')}</summary><pre>{data.candidate.notes || t('updateNoNotes')}</pre></details><p>{t('updateScope')}</p><div className="dad-update-actions"><Button size="sm" variant="outline" disabled={state.installing} onClick={controller.cancelReview}>{t('updateCancel')}</Button><Button size="sm" variant="primary" disabled={busy} onClick={() => { void controller.confirm(); }}>{t('updateConfirm')}</Button></div></div>}
    {state.uncertain && <Button size="sm" variant="outline" disabled={state.installing || state.checking} onClick={() => { void controller.retry(); }}>{t('updateRetry')}</Button>}
    <p className="dad-hint">{t('updateAutomatic')}{data?.checkedAt !== undefined && <> {t('updateChecked', { time: new Date(data.checkedAt).toLocaleString() })}</>}</p>
  </section>;
}
export const UPDATE_CSS = `
.dad-update{display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid var(--dsw-alias-border-l1,#8883);border-radius:10px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-primary,CanvasText);min-width:0}
.dad-update p{margin:0}.dad-update-heading,.dad-update-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}.dad-update-heading>div{display:flex;flex-direction:column;min-width:0}.dad-update-heading small{color:var(--dsw-alias-label-secondary,GrayText);overflow-wrap:anywhere}.dad-update a{color:var(--dsw-alias-button-primary-bg,#2878e0)}.dad-update a:focus-visible{outline:2px solid currentColor;outline-offset:2px}.dad-update-review{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--dsw-alias-border-l1,#8883);border-radius:8px}.dad-update pre{max-height:200px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;margin:6px 0}.dad-update details{min-width:0}.dad-update summary{cursor:pointer}.dad-update code{overflow-wrap:anywhere}.dad-update-attention{color:var(--dsw-alias-status-warning,#a57420)}
`;
