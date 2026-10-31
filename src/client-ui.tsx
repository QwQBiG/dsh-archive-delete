import React, { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { SUPPORTED_DSH_VERSION_LABEL, isSupportedDshVersion, type Action, type BatchResult, type ItemStatus, type Preview, type StorageOverview, type SupportStatus } from './contracts.js';
import { ArchiveClientController, canExecutePreview, pageCount, pageItems, sortedItems, type ArchiveSort, type ArchiveTab, type ClientError, type ClientState, type StorageClientState } from './client-state.js';
import type { UsageCategory, UsageCounters, UsageFile } from './storage-usage.js';
import { UpdateCard, updateEn, updateZh, UPDATE_CSS } from './update-ui.js';
import type { UpdateClientController } from './update-client.js';
import { formatTimestamp } from './client-format.js';

export const CLIENT_NAMESPACE = 'qwqbig.archiveDelete';
export const en = {
  ...updateEn,
  dateLocale: 'en-US',
  title: 'Archives, trash & storage', manage: 'Manage archives, trash and storage', menuTrash: 'Move to trash',
  archived: 'Archived', trash: 'Trash', storage: 'Storage overview', close: 'Close', refresh: 'Refresh', cancel: 'Cancel', back: 'Back',
  loading: 'Loading…', working: 'Processing the selected records…',
  intro: 'Clean up archived conversations, with the option to restore them.',
  scope: 'Session logs and their dedicated subagent logs are included. Shared attachments, spill files, project files and other plugins’ caches are retained.',
  noArchives: 'No archived conversations', noTrash: 'Your trash is empty',
  emptyArchivesHint: 'Conversations you archive in DSH will appear here.', emptyTrashHint: 'Moved conversations stay here until you restore or delete them.',
  selectAll: 'Select all ({n})', selected: '{n} selected',
  moveSelected: 'Move selected to trash', restoreSelected: 'Restore selected', purgeSelected: 'Delete permanently',
  moveTitle: 'Move these conversations to trash?', restoreTitle: 'Restore these conversations?', purgeTitle: 'Permanently delete these conversations?',
  moveDescription: 'Review the selected conversations and subagents before moving.',
  restoreDescription: 'Restore to the original workspace as archived. Removed workspaces become Ungrouped.',
  purgeDescription: 'Delete the selected logs and recovery records permanently. This cannot be undone.',
  confirmTrash: 'Confirm move to trash', confirmRestore: 'Confirm restore', confirmPurge: 'Confirm permanent deletion',
  previewExpired: 'This preview expired. Go back and review your selection again.',
  previewEmpty: 'No eligible records remain. Go back and refresh the list.',
  archivedHint: 'Running work and uncertain relationships stay protected.',
  trashHint: 'Restored conversations remain archived.',
  retention: 'No automatic deletion', scopeTitle: 'What this includes',
  pages: 'Conversation pages', previousPage: 'Previous', nextPage: 'Next', pageNumber: 'Page {page} of {pages}',
  pending: 'Pending restart', pendingHint: 'Still in the original location. Review again to try moving now.',
  cancelPending: 'Cancel pending move', reviewPending: 'Cancel waiting and review', pendingCancelled: 'Pending move cancelled',
  childCount: 'Subagents: {n}', memberCount: 'Conversations: {n}',
  ready: 'Ready', blocked: 'Protected', pendingPreview: 'Try idle release',
  previewCount: 'Selected: {n}', previewMembers: 'Conversations: {n}',
  previewDisposition: '{ready} ready · {pending} idle-release attempts · {blocked} protected and skipped',
  previewSize: 'Session log size: {size}', expires: 'Confirmation is valid until {time}.',
  result: 'Latest result', resultDetails: 'View details', resultSummary: '{succeeded} succeeded · {pending} pending · {skipped} skipped · {failed} failed',
  retry: 'Review and retry', retryRequest: 'Retry the same request', unknown: 'The request outcome is unconfirmed. Refresh its status or retry this request.',
  error: 'The operation could not be completed.', unsupported: 'Data operations are unavailable on this host.',
  supportDetails: 'Host: {version} · {platform}', errorDetails: 'Details', ungrouped: 'Ungrouped',
  'status.moved': 'Moved to trash', 'status.pending': 'Pending restart', 'status.restored': 'Restored',
  'status.purged': 'Permanently deleted', 'status.cancelled': 'Cancelled', 'status.skipped': 'Skipped', 'status.failed': 'Failed',
  checking: 'Checking the selected records…', operationContinues: 'Started operations continue after closing this window.',
  listFailure: 'Unable to read the current records. Refresh to try again.',
  reasonActive: 'This conversation or a related task is active. Finish it before continuing.',
  reasonBusy: 'Another process holds the session write lock. Close that instance and review again.',
  reasonLoaded: 'DSH still holds this idle conversation. It remains pending; cancel waiting and review to try again, or let the next startup recheck it.',
  reasonLifecycle: 'DSH could not confirm this conversation’s ownership. Refresh and review again.',
  reasonRelease: 'DSH could not release this idle conversation. Try again later.',
  reasonChanged: 'The archive state or session content changed. Review a new preview.',
  reasonRecovery: 'An interrupted operation needs recovery before another change is allowed.',
  reasonInterrupted: 'This operation was interrupted. Review its current state before retrying.',
  reasonPending: 'This conversation is already pending. Cancel waiting and review for a fresh confirmation.',
  reasonArchived: 'Only archived conversations can be moved to trash.',
  reasonMissing: 'The selected record no longer exists. Refresh the list.',
  reasonLineage: 'A related conversation has uncertain ownership. This group is protected.',
  reasonPath: 'The storage location could not be verified. Refresh and review again.',
  reasonConflict: 'The restore destination already contains files. Check that location before retrying.',
  reasonOverlap: 'These selections share a related conversation. Select each group once.',
  reasonPlatform: 'This release supports macOS and Windows Desktop.',
  reasonVersion: 'DSH Desktop {required} is required. Current version: {current}. Update DSH Desktop to {required}, then restart this plugin.',
  reasonBackend: 'The official JSONL storage backend is required.',
  reasonCapabilities: 'Required DSH services are unavailable or incompatible.',
  reasonInitialization: 'Archive storage could not be initialized. Check the host diagnostics and reload the plugin.',
  reasonStoreBusy: 'Another DSH process owns this trash store. Close that instance before continuing.',
  reasonTransport: 'DSH could not return a valid response. Check the connection and refresh to review the current state.',
  reasonDamaged: 'This record is incomplete or invalid. See details for the cause.',
  dataIssues: '{n} records or storage areas need attention', dataIssuesHint: 'These records are unavailable for selection. Expand details to see why.',
  storagePrevious: 'Showing the previous scan.',
  sort: 'Sort', sortDefault: 'Default order', sortSize: 'Largest first',
  storageIntro: 'File sizes and types in DSH or a selected workspace.',
  storageHost: 'DSH storage', storageHostScan: 'Scan DSH storage', storageWorkspace: 'Workspace', storageWorkspaceChoose: 'Choose a workspace…', storageWorkspaceScan: 'Scan selected workspace',
  storageWorkspaceHint: 'Choose a workspace, then scan.',
  storageReadOnly: 'Read-only', storageScanning: 'Reading file metadata…', storageCancel: 'Cancel scan',
  storageRefreshWorkspaces: 'Refresh workspace list',
  storageReasonBusy: 'The previous scan is still finishing. Wait a moment, then scan again.', storageReasonClosed: 'The plugin is stopping. Reload it before scanning again.',
  storageReasonWorkspaceChanged: 'The workspace changed during the scan. Refresh the workspace list, select it again and rescan.', storageReasonWorkspaceMissing: 'This workspace is no longer registered. Refresh the workspace list and choose another.',
  storageReasonUnsafeWorkspace: 'Choose a project folder outside protected DSH storage. Home folders, drive roots and redirected paths cannot be scanned as workspaces.',
  storageCancelled: 'Scan cancelled.', storageFailed: 'Storage could not be read. Try a new scan.', storageUnavailable: 'Storage overview is unavailable on this host.',
  storageEmpty: 'Start a scan to see storage usage', storageEmptyHint: 'Scan DSH or choose a workspace above.',
  storageMeasured: 'Measured files', storageMetric: 'Logical file sizes; duplicate paths and hard links are counted once.',
  storageComplete: 'Complete', storagePartial: 'Partial', storagePartialHint: 'Partial result. See scan details for skipped entries.',
  storageObserved: 'Observed {time} · {duration} ms', storageWindow: 'Scan started {time}', storageFiles: '{unique} unique files · {paths} file paths', storageDirectoryFiles: '{n} file paths',
  storageUnknown: 'Unknown', storageMissing: 'Not found', storageCategoryUnavailable: 'Unavailable', storageCategoryComplete: 'Complete', storageCategoryPartial: 'Partial',
  storageBreakdown: 'Storage categories', storageOverlap: 'Some categories overlap. Their sizes cannot be added together; the total above removes verified duplicates.', storageIdentity: 'File identity was unavailable for {n} paths; duplicate detection may be incomplete.', storageDeduplicated: 'Counted once: {links} duplicate hard links and {paths} repeated paths.',
  storageTypeBreakdown: 'File types', storageFileCount: '{n} files', storageUpdated: 'Updated {time}',
  storageOtherLocations: 'Other locations ({n})', storageUnavailableCount: '{n} unavailable', storageScanDetails: 'Statistics details', storageMoreFiles: 'More files ({n})',
  storageKindDependencies: 'Dependencies', storageKindBuild: 'Build folders', storageKindVersionControl: 'Version control', storageKindLogs: 'Logs', storageKindMedia: 'Media', storageKindArchives: 'Archives', storageKindCode: 'Code & config', storageKindDocuments: 'Documents', storageKindOther: 'Other files',
  storageDetails: 'Details', storageLargest: 'Largest files', storageDirectories: 'Top-level folders', storageRootFiles: 'Files at the root',
  storageDirectoryMetric: 'Folder totals count file paths, including hard-link aliases, and may overlap other categories.',
  storageNoFiles: 'No files measured in this category.', storageNoDirectories: 'No folder totals available.', storageSource: 'Origin unknown', storageProvenance: 'Types are identified from folder names and file extensions.',
  storageNotSnapshot: 'Files can change while a scan is running. Results describe the observation window, not a fixed snapshot.', storageIssues: 'Scan notes', storageOtherIssue: 'Some entries could not be measured ({code}).',
  storageIssueTime: 'Time limit reached', storageIssueEntries: 'Entry limit reached', storageIssueDepth: 'Folder depth limit reached', storageIssueCancelled: 'Scan cancelled', storageIssueLink: 'Symbolic link skipped', storageIssueDevice: 'Another volume skipped', storageIssueSpecial: 'Special file skipped', storageIssueChanged: 'File or folder changed during the scan', storageIssueUnreadable: 'File or folder could not be read', storageIssueRoot: 'Storage location is unavailable', storageIssueSize: 'Size could not be represented exactly', storageIssueMemory: 'This index is held in memory; there is no disk file to measure.',
  storageSkipped: 'Skipped or uncertain entries', storageCounterSymlinks: 'Symbolic links: {n}', storageCounterUnreadable: 'Unreadable: {n}', storageCounterChanged: 'Changed: {n}', storageCounterUnsupported: 'Unsupported: {n}', storageCounterCrossDevice: 'Other volumes: {n}', storageCounterDepth: 'Depth limits: {n}', storageCounterHardlinks: 'Duplicate hard links: {n}', storageCounterPaths: 'Duplicate paths: {n}', storageCounterExcluded: 'Separately categorized paths: {n}',
  storageCategorySessions: 'Session logs', storageCategoryTrash: 'Trash', storageCategoryStaging: 'Operation staging', storageCategoryReceipts: 'Operation receipts', storageCategoryOperations: 'Operation records', storageCategoryAttachments: 'Attachments', storageCategoryCache: 'DSH cache', storageCategoryAttachmentCache: 'Attachment cache', storageCategorySpill: 'Spill files', storageCategorySettings: 'DSH settings', storageCategoryWorkspace: 'Workspace files', storageCategoryProfiles: 'Plugin profiles', storageCategorySearch: 'Search index', storageCategoryOther: 'Other DSH files',
} as const;
export type TextKey = keyof typeof en;
export type Translate = (key: TextKey, values?: Record<string, string | number>) => string;
export const zh: Record<TextKey, string> = {
  ...updateZh,
  dateLocale: 'zh-CN',
  title: '归档、回收站与存储', manage: '管理归档、回收站与存储', menuTrash: '移入回收站',
  archived: '已归档', trash: '回收站', storage: '存储概览', close: '关闭', refresh: '刷新', cancel: '取消', back: '返回',
  loading: '正在读取…', working: '正在处理选中的记录…',
  intro: '清理已归档会话，需要时可以恢复。',
  scope: '处理范围包含会话日志及其专属子代理日志。共享附件、spill 文件、项目文件和其他插件缓存会保留。',
  noArchives: '暂无已归档会话', noTrash: '回收站为空',
  emptyArchivesHint: '在 DSH 中归档的会话会显示在这里。', emptyTrashHint: '移入的会话会保留，直到你选择恢复或清除。',
  selectAll: '全选（{n}）', selected: '已选择 {n} 项',
  moveSelected: '将所选移入回收站', restoreSelected: '恢复所选', purgeSelected: '永久清除',
  moveTitle: '将这些会话移入回收站？', restoreTitle: '恢复这些会话？', purgeTitle: '永久清除这些会话？',
  moveDescription: '核对所选会话及专属子代理后移入回收站。',
  restoreDescription: '恢复到原工作区并保持已归档；工作区已移除时归入“未分组”。',
  purgeDescription: '永久清除所选会话日志与恢复记录，无法撤销。',
  confirmTrash: '确认移入回收站', confirmRestore: '确认恢复', confirmPurge: '确认永久清除',
  previewExpired: '预览已过期，请返回并重新核对目标。',
  previewEmpty: '没有可操作记录，请返回并刷新列表。',
  archivedHint: '运行中的工作与关联不明的会话会受到保护。',
  trashHint: '恢复后仍保持已归档。',
  retention: '不会自动清除', scopeTitle: '处理范围',
  pages: '会话分页', previousPage: '上一页', nextPage: '下一页', pageNumber: '第 {page} / {pages} 页',
  pending: '待重启处理', pendingHint: '仍在原位置。可以重新核对，尝试立即移入回收站。',
  cancelPending: '取消待处理', reviewPending: '取消等待并重新核对', pendingCancelled: '已取消待处理',
  childCount: '子代理 {n}', memberCount: '会话 {n} 个',
  ready: '可执行', blocked: '已保护', pendingPreview: '尝试释放闲置占用',
  previewCount: '已选择 {n} 项', previewMembers: '共 {n} 个会话',
  previewDisposition: '{ready} 项可处理 · {pending} 项尝试释放闲置占用 · {blocked} 项受保护并跳过',
  previewSize: '会话日志大小：{size}', expires: '本次确认在 {time} 前有效。',
  result: '最近结果', resultDetails: '查看明细', resultSummary: '成功 {succeeded} · 待处理 {pending} · 跳过 {skipped} · 失败 {failed}',
  retry: '重新核对并重试', retryRequest: '重试同一次请求', unknown: '请求结果尚未确认，请刷新状态或重试此次请求。',
  error: '操作未能完成。', unsupported: '当前宿主暂不支持数据操作。',
  supportDetails: '宿主：{version} · {platform}', errorDetails: '详情', ungrouped: '未分组',
  'status.moved': '已移入回收站', 'status.pending': '待重启处理', 'status.restored': '已恢复',
  'status.purged': '已永久清除', 'status.cancelled': '已取消', 'status.skipped': '已跳过', 'status.failed': '失败',
  checking: '正在核对所选记录…', operationContinues: '关闭窗口后，已开始的操作会继续。',
  listFailure: '无法读取当前记录，请刷新重试。',
  reasonActive: '此会话或关联任务正在运行，请完成后重新核对。',
  reasonBusy: '其他进程持有会话写锁，请关闭相应实例后重新核对。',
  reasonLoaded: 'DSH 仍持有此闲置会话，暂保留待处理；可以取消等待并重新核对后再试，或等下次启动复查。',
  reasonLifecycle: 'DSH 无法确认此会话的持有状态，请刷新后重新核对。',
  reasonRelease: 'DSH 未能释放此闲置会话，请稍后重试。',
  reasonChanged: '归档状态或会话内容已经变化，请重新预览并确认。',
  reasonRecovery: '存在需要恢复的中断操作，恢复完成前不能继续修改。',
  reasonInterrupted: '上次操作已中断，请核对当前状态后重新确认。',
  reasonPending: '此会话已处于待处理状态，请取消等待并重新核对后确认。',
  reasonArchived: '只有已归档会话可以移入回收站。',
  reasonMissing: '所选记录已不存在，请刷新列表。',
  reasonLineage: '关联会话的归属不明确，已保护此组记录。',
  reasonPath: '存储位置校验失败，请刷新后重新核对。',
  reasonConflict: '恢复位置已存在文件，请检查该位置后重试。',
  reasonOverlap: '所选目标包含同一个关联会话，请勿重复选择同组记录。',
  reasonPlatform: '此版本支持 macOS 和 Windows 桌面端。',
  reasonVersion: '需要 DSH 桌面端 {required}，当前版本为 {current}。请将 DSH 桌面端更新至 {required}，然后重新启动此插件。',
  reasonBackend: '需要使用官方 JSONL 存储后端。',
  reasonCapabilities: '所需的 DSH 服务不可用或不兼容。',
  reasonInitialization: '回收站存储初始化失败，请检查宿主诊断后重新加载插件。',
  reasonStoreBusy: '其他 DSH 进程正在使用此回收站，请关闭相应实例后继续。',
  reasonTransport: 'DSH 未能返回有效响应，请检查连接并刷新，核对当前状态。',
  reasonDamaged: '此记录不完整或无效，可查看详情了解原因。',
  dataIssues: '{n} 条记录或存储区域需要检查', dataIssuesHint: '这些记录暂不可选，可展开详情查看原因。',
  storagePrevious: '上次扫描结果。',
  sort: '排序', sortDefault: '默认顺序', sortSize: '按大小从大到小',
  storageIntro: '查看 DSH 或工作区的文件大小与类型。',
  storageHost: 'DSH 存储', storageHostScan: '扫描 DSH 存储', storageWorkspace: '工作区', storageWorkspaceChoose: '请选择工作区…', storageWorkspaceScan: '扫描所选工作区',
  storageWorkspaceHint: '选择工作区后点击扫描。',
  storageReadOnly: '只读', storageScanning: '正在读取文件信息…', storageCancel: '取消扫描',
  storageRefreshWorkspaces: '刷新工作区列表',
  storageReasonBusy: '上一次扫描仍在结束，请稍候再扫描。', storageReasonClosed: '插件正在停止，请重新加载后再扫描。',
  storageReasonWorkspaceChanged: '扫描期间工作区发生变化，请刷新工作区列表，重新选择后再扫描。', storageReasonWorkspaceMissing: '此工作区已不再登记，请刷新工作区列表后重新选择。',
  storageReasonUnsafeWorkspace: '请选择受保护的 DSH 存储以外的项目目录；用户主目录、磁盘根目录和重定向路径不能作为工作区扫描。',
  storageCancelled: '扫描已取消。', storageFailed: '无法读取存储信息，请重新扫描。', storageUnavailable: '当前宿主暂不支持存储概览。',
  storageEmpty: '开始扫描后查看存储分布', storageEmptyHint: '扫描 DSH，或在上方选择工作区。',
  storageMeasured: '已统计文件大小', storageMetric: '按文件大小统计，重复路径与硬链接合并计数。',
  storageComplete: '完整', storagePartial: '部分', storagePartialHint: '已统计部分文件，详情可查看扫描记录。',
  storageObserved: '统计于 {time} · 用时 {duration} 毫秒', storageWindow: '扫描开始于 {time}', storageFiles: '{unique} 个独立文件 · {paths} 个文件路径', storageDirectoryFiles: '{n} 个文件路径',
  storageUnknown: '未知', storageMissing: '未找到', storageCategoryUnavailable: '不可用', storageCategoryComplete: '完整', storageCategoryPartial: '部分',
  storageBreakdown: '存储分类', storageOverlap: '部分分类存在重叠，大小不能直接相加；上方总计已移除能够验证的重复项。', storageIdentity: '有 {n} 个路径无法验证文件标识，可能无法完整识别重复项。', storageDeduplicated: '已合并计数：重复硬链接 {links} 个，重复路径 {paths} 个。',
  storageTypeBreakdown: '文件类型', storageFileCount: '{n} 个文件', storageUpdated: '统计于 {time}',
  storageOtherLocations: '其他位置（{n}）', storageUnavailableCount: '{n} 处不可用', storageScanDetails: '统计详情', storageMoreFiles: '更多文件（{n}）',
  storageKindDependencies: '依赖目录', storageKindBuild: '构建目录', storageKindVersionControl: '版本控制', storageKindLogs: '日志', storageKindMedia: '图片、音视频', storageKindArchives: '压缩包', storageKindCode: '代码与配置', storageKindDocuments: '文档', storageKindOther: '其他文件',
  storageDetails: '详情', storageLargest: '大文件', storageDirectories: '一级目录', storageRootFiles: '根目录下的文件',
  storageDirectoryMetric: '目录大小按文件路径统计，包含硬链接别名，也可能与其他分类重叠。',
  storageNoFiles: '此分类尚未统计到文件。', storageNoDirectories: '暂无目录统计。', storageSource: '来源未知', storageProvenance: '文件类型依据目录名和扩展名识别。',
  storageNotSnapshot: '扫描期间文件可能变化，结果反映本次观察时段，并非固定快照。', storageIssues: '扫描说明', storageOtherIssue: '部分条目无法统计（{code}）。',
  storageIssueTime: '已达到时间上限', storageIssueEntries: '已达到条目数量上限', storageIssueDepth: '已达到目录深度上限', storageIssueCancelled: '扫描已取消', storageIssueLink: '已跳过符号链接', storageIssueDevice: '已跳过其他卷', storageIssueSpecial: '已跳过特殊文件', storageIssueChanged: '扫描期间文件或目录发生变化', storageIssueUnreadable: '无法读取文件或目录', storageIssueRoot: '存储位置不可用', storageIssueSize: '无法精确表示文件大小', storageIssueMemory: '此索引存于内存，没有可统计的磁盘文件。',
  storageSkipped: '跳过或无法确认的条目', storageCounterSymlinks: '符号链接 {n}', storageCounterUnreadable: '无法读取 {n}', storageCounterChanged: '发生变化 {n}', storageCounterUnsupported: '不支持 {n}', storageCounterCrossDevice: '其他卷 {n}', storageCounterDepth: '深度限制 {n}', storageCounterHardlinks: '重复硬链接 {n}', storageCounterPaths: '重复路径 {n}', storageCounterExcluded: '已单独分类的路径 {n}',
  storageCategorySessions: '会话日志', storageCategoryTrash: '回收站', storageCategoryStaging: '操作暂存', storageCategoryReceipts: '操作回执', storageCategoryOperations: '操作记录', storageCategoryAttachments: '附件', storageCategoryCache: 'DSH 缓存', storageCategoryAttachmentCache: '附件缓存', storageCategorySpill: '溢出文件', storageCategorySettings: 'DSH 设置', storageCategoryWorkspace: '工作区文件', storageCategoryProfiles: '插件环境', storageCategorySearch: '搜索索引', storageCategoryOther: '其他 DSH 文件',
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
    'request-failed': 'reasonTransport', 'list-failed': 'reasonTransport',
    'invalid-session': 'reasonDamaged', 'corrupt-state': 'reasonDamaged', 'entry-unavailable': 'reasonDamaged',
    'update-in-progress': 'updateWaiting', 'update-restart-required': 'updateRestart',
  };
  const key = code ? keys[code] : undefined;
  return key ? t(key) : message;
}

/** Keep identical diagnostic occurrences visible without assigning duplicate React keys. */
function diagnosticRows<T>(items: readonly T[], identity: (item: T) => string): Array<{ item: T; key: string }> {
  const occurrences = new Map<string, number>();
  return items.map(item => {
    const signature = identity(item);
    const occurrence = occurrences.get(signature) ?? 0;
    occurrences.set(signature, occurrence + 1);
    return { item, key: JSON.stringify([signature, occurrence]) };
  });
}

function supportReason(status: SupportStatus, t: Translate): string {
  const message = status.reason;
  if (!message) return t('reasonCapabilities');
  if (message.startsWith('Only macOS')) return t('reasonPlatform');
  if (!isSupportedDshVersion(status.version) && message.startsWith('DSH Desktop ') && message.includes(' is required;')) return t('reasonVersion', { required: SUPPORTED_DSH_VERSION_LABEL, current: status.version });
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

function EmptyState({ tab, t }: { tab: Exclude<ArchiveTab, 'storage'>; t: Translate }) {
  return <div className="dad-empty"><span className="dad-empty-icon"><ArchiveIcon trash={tab === 'trash'} /></span><strong>{t(tab === 'archived' ? 'noArchives' : 'noTrash')}</strong><p>{t(tab === 'archived' ? 'emptyArchivesHint' : 'emptyTrashHint')}</p></div>;
}

function storageCategoryTitle(category: UsageCategory, t: Translate): string {
  const names: Record<string, TextKey> = {
    sessions: 'storageCategorySessions', 'session-logs': 'storageCategorySessions',
    trash: 'storageCategoryTrash', staging: 'storageCategoryStaging', receipts: 'storageCategoryReceipts', operations: 'storageCategoryOperations',
    attachments: 'storageCategoryAttachments', cache: 'storageCategoryCache', 'attachment-cache': 'storageCategoryAttachmentCache',
    spill: 'storageCategorySpill', settings: 'storageCategorySettings', workspace: 'storageCategoryWorkspace', profiles: 'storageCategoryProfiles', search: 'storageCategorySearch', other: 'storageCategoryOther',
  };
  const key = names[category.kind];
  return category.kind === 'workspace' && category.label ? category.label : t(key ?? 'storageCategoryOther');
}

function storageIssue(code: string, t: Translate): string {
  const keys: Record<string, TextKey> = {
    'time-budget': 'storageIssueTime', 'entry-budget': 'storageIssueEntries', 'depth-limit': 'storageIssueDepth',
    cancelled: 'storageIssueCancelled', 'link-skipped': 'storageIssueLink', 'cross-device-skipped': 'storageIssueDevice', 'special-file-skipped': 'storageIssueSpecial',
    'entry-changed': 'storageIssueChanged', 'entry-disappeared': 'storageIssueChanged', 'directory-changed': 'storageIssueChanged', 'path-redirected': 'storageIssueChanged', 'root-changed': 'storageIssueChanged',
    'entry-unreadable': 'storageIssueUnreadable', 'directory-unreadable': 'storageIssueUnreadable',
    'root-unresolved': 'storageIssueRoot', 'unsafe-root': 'storageIssueRoot', ENOENT: 'storageIssueRoot',
    'size-unrepresentable': 'storageIssueSize', 'aggregate-size-limit': 'storageIssueSize',
    'in-memory': 'storageIssueMemory',
  };
  return keys[code] ? t(keys[code]) : t('storageOtherIssue', { code });
}

const counterLabels: Partial<Record<keyof UsageCounters, TextKey>> = {
  symlinks: 'storageCounterSymlinks', unreadable: 'storageCounterUnreadable', changed: 'storageCounterChanged', unsupported: 'storageCounterUnsupported',
  crossDevice: 'storageCounterCrossDevice', depthLimit: 'storageCounterDepth', duplicateHardlinks: 'storageCounterHardlinks', duplicatePaths: 'storageCounterPaths',
  excluded: 'storageCounterExcluded',
};

const fileKindLabels: Record<string, TextKey> = {
  dependencies: 'storageKindDependencies', build: 'storageKindBuild', 'version-control': 'storageKindVersionControl',
  logs: 'storageKindLogs', media: 'storageKindMedia', archives: 'storageKindArchives', code: 'storageKindCode', documents: 'storageKindDocuments', other: 'storageKindOther',
};

function FileKindsContent({ category, t }: { category: UsageCategory; t: Translate }) {
  const kinds = category.fileKinds?.filter(item => item.fileCount > 0).toSorted((a, b) => b.fileBytes - a.fileBytes || a.kind.localeCompare(b.kind));
  if (!kinds?.length) return null;
  return <section className="dad-storage-kinds" aria-label={t('storageTypeBreakdown')}>
    <h3>{t('storageTypeBreakdown')}</h3>
    <ul>{kinds.map(item => <li key={item.kind}><span>{t(fileKindLabels[item.kind] ?? 'storageKindOther')}</span><strong>{formatBytes(item.fileBytes)}</strong><small>{t('storageFileCount', { n: item.fileCount })}</small></li>)}</ul>
  </section>;
}

function StorageFileList({ files, t }: { files: readonly UsageFile[]; t: Translate }) {
  return files.length === 0 ? <p className="dad-hint">{t('storageNoFiles')}</p> : <ul className="dad-storage-paths">{files.map(file => <li key={file.relativePath}><code>{file.relativePath}</code>{file.kind && <span className="dad-file-kind">{t(fileKindLabels[file.kind] ?? 'storageKindOther')}</span>}<span>{formatBytes(file.sizeBytes)}</span></li>)}</ul>;
}

function StorageDirectories({ category, t }: { category: UsageCategory; t: Translate }) {
  return category.directories.length === 0 ? <p className="dad-hint">{t('storageNoDirectories')}</p> : <ul className="dad-storage-paths">{category.directories.map(directory => <li key={directory.relativePath}><code>{directory.relativePath === '.' ? t('storageRootFiles') : directory.relativePath}</code><span>{formatBytes(directory.fileBytes)}</span><small>{t('storageDirectoryFiles', { n: directory.fileCount })}</small></li>)}</ul>;
}

const storageStatusKeys: Record<UsageCategory['status'], TextKey> = { complete: 'storageCategoryComplete', partial: 'storageCategoryPartial', missing: 'storageMissing', unavailable: 'storageCategoryUnavailable' };
function StorageCategoryRow({ category, t }: { category: UsageCategory; t: Translate }) {
  return <details className="dad-storage-category" data-category={category.id}>
    <summary><strong>{storageCategoryTitle(category, t)}</strong>{category.fileBytes !== null && <small>{t('storageFileCount', { n: category.uniqueFileCount })}</small>}<span className="dad-storage-category-size">{category.fileBytes === null ? t('storageUnknown') : formatBytes(category.fileBytes)}</span>{category.status !== 'complete' && <span className="dad-badge">{t(storageStatusKeys[category.status])}</span>}</summary>
    <div className="dad-storage-category-body">
      <FileKindsContent category={category} t={t} />
      <h4>{t('storageLargest')}</h4><StorageFileList files={category.largestFiles} t={t} />
      <h4>{t('storageDirectories')}</h4><StorageDirectories category={category} t={t} />
    </div>
  </details>;
}

export function StorageResultContent({ result, t }: { result: StorageOverview; t: Translate }) {
  const categories = result.categories.toSorted((a, b) => (b.fileBytes ?? -1) - (a.fileBytes ?? -1));
  const measured = result.categories.some(category => category.fileBytes !== null);
  const workspace = result.workspaces.find(item => item.id === result.workspaceId);
  const project = result.scope === 'workspace' ? categories.find(category => category.kind === 'workspace' && category.fileBytes !== null) : undefined;
  const locations = categories.filter(category => category !== project);
  const visible = locations.filter(category => (category.fileBytes ?? 0) > 0);
  const other = locations.filter(category => !(category.fileBytes !== null && category.fileBytes > 0));
  const unavailable = other.filter(category => category.status === 'unavailable' || category.status === 'missing').length;
  const notes = categories.filter(category => category.issues.length > 0 || Object.entries(counterLabels).some(([key]) => category.counters[key as keyof UsageCounters] > 0));
  return <div className="dad-storage-result">
    <section className="dad-storage-total" aria-label={t('storageMeasured')}>
      <div className="dad-storage-total-heading"><span>{result.scope === 'host' ? t('storageHost') : workspace?.title || t('storageWorkspace')}</span><span className="dad-badge">{t(result.complete ? 'storageComplete' : 'storagePartial')}</span></div>
      <span className="dad-muted">{t('storageMeasured')}</span><div className="dad-storage-size-row"><strong className="dad-storage-size">{measured ? formatBytes(result.fileBytes) : t('storageUnknown')}</strong>{measured && <span>{t('storageFileCount', { n: result.uniqueFileCount })}</span>}</div>
      <time dateTime={isoTime(result.finishedAt)} className="dad-hint">{t('storageUpdated', { time: formatTimestamp(result.finishedAt, t) })}</time>
      {!result.complete && <p className="dad-storage-partial" role="status">{t('storagePartialHint')}</p>}
    </section>
    {project && <>
      <FileKindsContent category={project} t={t} />
      <section className="dad-storage-project-files" aria-label={t('storageLargest')}><h3>{t('storageLargest')}</h3><StorageFileList files={project.largestFiles.slice(0, 5)} t={t} />{project.largestFiles.length > 5 && <details className="dad-storage-details"><summary>{t('storageMoreFiles', { n: project.largestFiles.length - 5 })}</summary><StorageFileList files={project.largestFiles.slice(5)} t={t} /></details>}</section>
      {project.directories.length > 0 && <details className="dad-storage-details dad-storage-folders"><summary>{t('storageDirectories')}</summary><StorageDirectories category={project} t={t} /></details>}
    </>}
    {visible.length > 0 && <section aria-label={t('storageBreakdown')} className="dad-storage-categories"><h3>{t('storageBreakdown')}</h3>{visible.map(category => <StorageCategoryRow key={category.id} category={category} t={t} />)}</section>}
    {other.length > 0 && <details className="dad-storage-other"><summary>{t('storageOtherLocations', { n: other.length })}{unavailable > 0 && <span className="dad-badge">{t('storageUnavailableCount', { n: unavailable })}</span>}</summary><div className="dad-storage-categories">{other.map(category => <StorageCategoryRow key={category.id} category={category} t={t} />)}</div></details>}
    <details className="dad-storage-scan-details dad-storage-details"><summary>{t('storageScanDetails')}</summary>
      <p className="dad-hint">{t('storageMetric')} {t('storageProvenance')}</p>
      <p className="dad-hint">{t('storageFiles', { unique: result.uniqueFileCount, paths: result.fileCount })}</p>
      <p className="dad-hint">{t('storageObserved', { time: formatTimestamp(result.finishedAt, t), duration: Math.round(result.durationMs) })}</p>
      {result.categories.some(category => category.overlaps.length > 0) && <p className="dad-hint">{t('storageOverlap')}</p>}
      {(result.duplicateHardlinks > 0 || result.duplicatePaths > 0) && <p className="dad-hint">{t('storageDeduplicated', { links: result.duplicateHardlinks, paths: result.duplicatePaths })}</p>}
      {result.identityUnknown > 0 && <p className="dad-hint">{t('storageIdentity', { n: result.identityUnknown })}</p>}
      {notes.map(category => <div className="dad-storage-category-notes" key={category.id}><h4>{storageCategoryTitle(category, t)}</h4>
        <ul className="dad-storage-notes">{Object.entries(counterLabels).filter(([key]) => category.counters[key as keyof UsageCounters] > 0).map(([key, label]) => <li key={key}>{t(label, { n: category.counters[key as keyof UsageCounters] })}</li>)}{diagnosticRows(category.issues, issue => JSON.stringify([issue.code, issue.relativePath])).map(({ item: issue, key }) => <li key={key}>{storageIssue(issue.code, t)}{issue.relativePath && <> · <code>{issue.relativePath}</code></>}</li>)}</ul>
      </div>)}
    </details>
  </div>;
}

export function StorageContent({ state, workspaces, controller, supported, t, Button }: {
  state: StorageClientState; workspaces: readonly { id: string; title: string }[]; controller: ArchiveClientController;
  supported: boolean; t: Translate; Button: NativePrimitives['Button'];
}) {
  const workspaceId = useId();
  const available = supported && controller.storageAvailable;
  const errorKeys: Record<string, TextKey> = { 'scan-busy': 'storageReasonBusy', 'scan-closed': 'storageReasonClosed',
    'workspace-changed': 'storageReasonWorkspaceChanged', 'workspace-not-found': 'storageReasonWorkspaceMissing',
    'unsafe-workspace': 'storageReasonUnsafeWorkspace', 'scan-cancelled': 'storageCancelled', 'unsupported-host': 'storageUnavailable' };
  return <div className="dad-storage">
    <div className="dad-storage-intro"><span className="dad-badge">{t('storageReadOnly')}</span></div>
    {!available && <p className="dad-alert" role="status">{t('storageUnavailable')}</p>}
    <div className="dad-storage-controls">
      <Button variant="outline" disabled={!available || state.scanning} onClick={() => { void controller.scanStorage('host'); }}>{t('storageHostScan')}</Button>
      <div className="dad-storage-workspace"><label htmlFor={workspaceId}>{t('storageWorkspace')}</label><select id={workspaceId} value={state.workspaceId} disabled={!available} onChange={event => controller.setStorageWorkspace(event.target.value)}><option value="">{t('storageWorkspaceChoose')}</option>{workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.title}</option>)}</select><Button variant="outline" disabled={!available || state.scanning || !workspaces.some(workspace => workspace.id === state.workspaceId)} onClick={() => { void controller.scanStorage('workspace'); }}>{t('storageWorkspaceScan')}</Button></div>
    </div>
    {state.scanning && <div className="dad-storage-scanning" role="status"><span>{t('storageScanning')}</span><Button size="sm" variant="ghost" onClick={controller.cancelStorage}>{t('storageCancel')}</Button></div>}
    {state.cancelled && <p className="dad-hint" role="status">{t('storageCancelled')}</p>}
    {state.error && <section className="dad-alert dad-error" role="alert"><p>{t('storageFailed')}</p>{errorKeys[state.error.code] && <p>{t(errorKeys[state.error.code]!)}</p>}<details><summary>{t('errorDetails')}</summary><code>{state.error.code}</code></details></section>}
    {state.result && (state.scanning || state.error || state.cancelled) && <p className="dad-hint" role="status">{t('storagePrevious')}</p>}
    {state.result ? <StorageResultContent result={state.result} t={t} /> : !state.scanning && !state.error && <div className="dad-empty dad-storage-empty"><strong>{t('storageEmpty')}</strong><p>{t('storageEmptyHint')}</p></div>}
  </div>;
}

export function PreviewContent({ preview, t }: { preview: Preview; t: Translate }) {
  const members = preview.items.reduce((sum, item) => sum + item.memberIds.length, 0);
  const counts = { ready: 0, pending: 0, blocked: 0 };
  for (const item of preview.items) counts[item.disposition]++;
  return <div className="dad-preview">
    <div className="dad-summary"><strong>{t('previewCount', { n: preview.items.length })}</strong><span>{t('previewMembers', { n: members })}</span><span>{formatBytes(preview.items.reduce((sum, item) => sum + item.sizeBytes, 0))}</span></div>
    <p className="dad-muted">{t('previewDisposition', counts)}</p>
    <ul className="dad-preview-list">
      {preview.items.map((item) => <li key={item.id}>
        <div className="dad-row-title"><strong>{item.title || item.sessionId}</strong><span className={`dad-pill dad-pill-${item.disposition}`}>{t(item.disposition === 'ready' ? 'ready' : item.disposition === 'pending' ? 'pendingPreview' : 'blocked')}</span></div>
        <div className="dad-meta"><span>{t('memberCount', { n: item.memberIds.length })}</span><span>{formatBytes(item.sizeBytes)}</span></div>
        {(item.disposition === 'pending' || item.message) && <p className="dad-item-reason">{item.disposition === 'pending' ? t('pendingHint') : localizeReason(item.code, item.message!, t)}</p>}
      </li>)}
    </ul>
    <section className={`dad-boundary${preview.action === 'purge' ? ' dad-boundary-danger' : ''}`}><span className="dad-boundary-icon"><ArchiveIcon trash={preview.action === 'purge'} /></span><div><strong>{t('scopeTitle')}</strong><p>{t('scope')}</p></div></section>
    <p className="dad-expiry">{t('expires', { time: formatTimestamp(preview.expiresAt, t) })}</p>
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

export function ArchiveDialog({ controller, primitives, t, updates }: {
  controller: ArchiveClientController; primitives: NativePrimitives; t: Translate; updates?: UpdateClientController;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  return <ArchiveDialogView state={state} controller={controller} primitives={primitives} t={t} {...(updates ? { updates } : {})} />;
}

export function ArchiveDialogView({ state, controller, primitives, t, updates }: {
  state: ClientState; controller: ArchiveClientController; primitives: NativePrimitives; t: Translate; updates?: UpdateClientController;
}) {
  const { Button, Checkbox, Modal } = primitives;
  const tabsId = useId();
  const tabs: readonly ArchiveTab[] = ['archived', 'trash', 'storage'];
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const backAnchor = useRef<HTMLSpanElement>(null);
  const archivedItems = useMemo(() => sortedItems(state.overview?.archived ?? [], state.sort), [state.overview?.archived, state.sort]);
  const trashItems = useMemo(() => sortedItems(state.overview?.trash ?? [], state.sort), [state.overview?.trash, state.sort]);
  const archivedPage = pageItems(archivedItems, state.page);
  const trashPage = pageItems(trashItems, state.page);
  const eligibleIds = state.tab === 'storage' ? [] : state.tab === 'archived'
    ? archivedPage.filter(item => !item.pending).map(item => item.id) : trashPage.map(item => item.id);
  const eligibleSet = new Set(eligibleIds);
  const selected = state.selected.filter(id => eligibleSet.has(id));
  const selectedSet = new Set(selected);
  const pages = pageCount(state);
  const supported = state.overview?.support.supported === true;
  const uncertain = state.uncertainRequest;
  const locked = state.busy || state.loading || uncertain || state.maintenance;
  const preview = state.preview;
  const previewId = preview?.id;
  const [, updateExpiry] = useState(0);
  const result = state.result ?? state.overview?.recentResults[0] ?? null;
  const actionTitle: Record<Action, TextKey> = { trash: 'moveTitle', restore: 'restoreTitle', purge: 'purgeTitle' };
  const actionDescription: Record<Action, TextKey> = { trash: 'moveDescription', restore: 'restoreDescription', purge: 'purgeDescription' };
  const actionConfirm: Record<Action, TextKey> = { trash: 'confirmTrash', restore: 'confirmRestore', purge: 'confirmPurge' };
  useEffect(() => {
    if (!state.open || !preview || preview.expiresAt <= Date.now()) return;
    const timer = setTimeout(() => updateExpiry(value => value + 1), Math.min(2_147_483_647, preview.expiresAt - Date.now() + 1));
    return () => clearTimeout(timer);
  }, [state.open, preview]);
  useEffect(() => {
    if (!state.open) return;
    if (previewId) backAnchor.current?.querySelector('button')?.focus();
    else tabRefs.current[['archived', 'trash', 'storage'].indexOf(state.tab)]?.focus();
  }, [state.open, previewId, state.tab]);

  const changeTab = (tab: ArchiveTab, focus = false) => {
    controller.setTab(tab);
    if (focus) tabRefs.current[tabs.indexOf(tab)]?.focus();
  };
  const footer = preview ? <>
    <span ref={backAnchor}><Button variant="outline" disabled={state.busy || uncertain} onClick={controller.dismissPreview} data-modal-autofocus="">{t('back')}</Button></span>
    <Button variant="primary" className={preview.action === 'purge' ? 'dad-danger-confirm' : undefined} disabled={locked || !supported || !canExecutePreview(preview)} onClick={() => { void controller.confirm(); }}>{t(actionConfirm[preview.action])}</Button>
  </> : state.tab === 'storage' ? <Button variant="outline" onClick={controller.close}>{t('close')}</Button> : <>
    <span className="dad-selection" aria-live="polite">{t('selected', { n: selected.length })}</span>
    <Button variant="outline" onClick={controller.close}>{t('close')}</Button>
    {state.tab === 'archived'
      ? <Button variant="primary" disabled={locked || !supported || selected.length === 0} onClick={() => { void controller.preview('trash'); }}>{t('moveSelected')}</Button>
      : <><Button variant="outline" disabled={locked || !supported || selected.length === 0} onClick={() => { void controller.preview('restore'); }}>{t('restoreSelected')}</Button><Button variant="outline" className="dad-danger" disabled={locked || !supported || selected.length === 0} onClick={() => { void controller.preview('purge'); }}>{t('purgeSelected')}</Button></>}
  </>;

  return <Modal open={state.open} onClose={controller.close} title={preview ? t(actionTitle[preview.action]) : t('title')} description={preview ? t(actionDescription[preview.action]) : state.tab === 'storage' ? t('storageIntro') : t('intro')} closeLabel={t('close')} className="dad-dialog" contentClassName="dad-content" footer={footer}>
    <div className="dad-shell">
      {updates && !preview && <UpdateCard controller={updates} Button={Button} t={t} archiveBusy={state.busy || state.loading || uncertain} />}
      {state.maintenance && <p className="dad-muted" role="status">{t('updateWaiting')}</p>}
      {state.error && <ErrorNotice error={uncertain ? { ...state.error, uncertain: true } : state.error} t={t} onRefresh={() => { void controller.refresh(); }} onRetry={() => { void controller.retryUncertain(); }} disabled={state.busy || state.loading} Button={Button} />}
      {state.overview && !supported && <section className="dad-alert" role="status"><strong>{t('unsupported')}</strong><p>{supportReason(state.overview.support, t)}</p><small>{t('supportDetails', { version: state.overview.support.version, platform: state.overview.support.platform })}</small></section>}
      {!!state.overview?.issues?.length && <section className="dad-alert" role="status"><strong>{t('dataIssues', { n: state.overview.issues.length })}</strong><p>{t('dataIssuesHint')}</p><details><summary>{t('errorDetails')}</summary><ul>{diagnosticRows(state.overview.issues, issue => JSON.stringify([issue.scope, issue.id, issue.code, issue.message])).map(({ item: issue, key }) => <li key={key}>{t(issue.scope === 'archive' ? 'archived' : 'trash')}{issue.id && <> · <code>{issue.id}</code></>} — {localizeReason(issue.code, issue.message, t)} <code>{issue.code}</code></li>)}</ul></details></section>}
      {state.busy && <p className="dad-progress" role="status">{t('working')}</p>}
      {preview ? <><PreviewContent preview={preview} t={t} />{preview.expiresAt <= Date.now() && <p className="dad-muted" role="status">{t('previewExpired')}</p>}</> : <>
        <div className="dad-toolbar">
          <div className="dad-tabs" role="tablist" aria-label={t('title')} onKeyDown={(event) => {
            if (locked) return;
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const index = tabs.indexOf(state.tab);
            changeTab(event.key === 'Home' ? 'archived' : event.key === 'End' ? 'storage' : tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]!, true);
          }}>
            {tabs.map((tab, index) => <button key={tab} ref={(element) => { tabRefs.current[index] = element; }} type="button" role="tab" id={`${tabsId}-${tab}`} aria-controls={`${tabsId}-panel`} aria-selected={state.tab === tab} tabIndex={state.tab === tab ? 0 : -1} disabled={locked} data-modal-autofocus={state.tab === tab ? '' : undefined} onClick={() => changeTab(tab)}>{t(tab)}{tab !== 'storage' && <span className="dad-count">{state.overview?.[tab].length ?? 0}</span>}</button>)}
          </div>
          <Button size="sm" variant="outline" disabled={state.loading || state.busy} onClick={() => { void controller.refresh(); }}>{t(state.tab === 'storage' ? 'storageRefreshWorkspaces' : 'refresh')}</Button>
        </div>
        {state.tab === 'storage' ? <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-storage`} aria-busy={state.storage.scanning}><StorageContent state={state.storage} workspaces={state.overview?.storageWorkspaces ?? []} controller={controller} supported={supported} t={t} Button={Button} /></div> : <>
        <div className="dad-list-heading"><Checkbox checked={eligibleIds.length > 0 && selected.length === eligibleIds.length} disabled={locked || !supported || eligibleIds.length === 0} onChange={controller.selectAll} label={t('selectAll', { n: eligibleIds.length })} /><label className="dad-sort"><span>{t('sort')}</span><select value={state.sort} disabled={locked} onChange={event => controller.setSort(event.target.value as ArchiveSort)}><option value="default">{t('sortDefault')}</option><option value="size-desc">{t('sortSize')}</option></select></label><span className="dad-retention"><span aria-hidden="true">◷</span>{t('retention')}</span></div>
        <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${state.tab}`} aria-busy={state.loading} className="dad-list">
          {state.loading && <p role="status">{t('loading')}</p>}
          {!state.loading && state.overview && state.overview[state.tab].length === 0 && <EmptyState tab={state.tab} t={t} />}
          {state.tab === 'archived' ? archivedPage.map((item) => <div className="dad-row" key={item.id} data-selected={selectedSet.has(item.id)} data-pending={item.pending === true}>
            <div className="dad-row-main"><Checkbox checked={selectedSet.has(item.id)} disabled={locked || !supported || item.pending === true} onChange={() => controller.toggle(item.id)} label={item.title || item.id} /><div className="dad-meta"><span className="dad-workspace">{item.workspace || t('ungrouped')}</span><span>{formatBytes(item.sizeBytes)}</span>{item.descendantCount > 0 && <span className="dad-badge">{t('childCount', { n: item.descendantCount })}</span>}{item.pending && <span className="dad-badge dad-badge-pending">{t('pending')}</span>}</div>{item.pending && <p className="dad-pending">{t('pendingHint')}</p>}</div>
            {item.pending && <div className="dad-row-actions"><Button size="sm" variant="outline" disabled={locked || !supported} onClick={() => { void controller.reviewPending(item.id); }}>{t('reviewPending')}</Button><Button size="sm" variant="ghost" disabled={locked || !supported} onClick={() => { void controller.cancelPending([item.id]); }}>{t('cancelPending')}</Button></div>}
          </div>) : trashPage.map((item) => <div className="dad-row" key={item.id} data-selected={selectedSet.has(item.id)}>
            <div className="dad-row-main"><Checkbox checked={selectedSet.has(item.id)} disabled={locked || !supported} onChange={() => controller.toggle(item.id)} label={item.title || item.sessionId} /><div className="dad-meta"><time dateTime={isoTime(item.trashedAt)}>{formatTimestamp(item.trashedAt, t)}</time><span>{formatBytes(item.sizeBytes)}</span><span className="dad-badge">{t('memberCount', { n: item.memberCount })}</span></div></div>
          </div>)}
        </div>
        <div className="dad-list-foot"><p className="dad-hint">{t(state.tab === 'archived' ? 'archivedHint' : 'trashHint')}</p>{pages > 1 && <nav className="dad-pagination" aria-label={t('pages')}><Button size="sm" variant="ghost" disabled={locked || state.page === 0} onClick={() => controller.setPage(state.page - 1)}>{t('previousPage')}</Button><span>{t('pageNumber', { page: state.page + 1, pages })}</span><Button size="sm" variant="ghost" disabled={locked || state.page + 1 >= pages} onClick={() => controller.setPage(state.page + 1)}>{t('nextPage')}</Button></nav>}</div>
        {result && <ResultContent result={result} t={t} retry={(id) => { void controller.retryItem(id); }} disabled={locked || !supported} Button={Button} />}
        </>}
      </>}
      {(state.busy || uncertain) && <p className="dad-muted">{t('operationContinues')}</p>}
    </div>
  </Modal>;
}

export const CLIENT_CSS = UPDATE_CSS + `
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
.dad-danger{color:var(--dsw-alias-status-error,#bd3d3d)!important}.dad-danger-confirm{background:#b91c1c!important;border-color:#b91c1c!important;color:#fff!important}.dad-danger-confirm:not(:disabled):hover{background:#991b1b!important}.dad-results{border:1px solid var(--dad-border);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#88805);font-size:11px}.dad-results summary{display:flex;align-items:center;gap:10px;list-style:none;padding:10px 12px;cursor:pointer}.dad-results summary::-webkit-details-marker{display:none}.dad-results summary:focus-visible{outline:2px solid var(--dsw-alias-button-primary-bg,#2878e0);outline-offset:2px;border-radius:9px}.dad-result-label{font-weight:500;white-space:nowrap}.dad-result-summary{flex:1;color:var(--dad-muted);font-variant-numeric:tabular-nums}.dad-result-disclosure{font-size:16px;line-height:1;color:var(--dad-muted);transition:transform .15s}.dad-results[open] .dad-result-disclosure{transform:rotate(180deg)}.dad-results[open] summary{border-bottom:1px solid var(--dad-border)}.dad-results ul{padding:0 12px;max-height:190px;overflow:auto}.dad-results li{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid var(--dad-border)}.dad-results li:last-child{border-bottom:0}.dad-results li>div{min-width:0}.dad-results li strong{font-weight:500;overflow-wrap:anywhere}.dad-result-status{display:inline-block;margin-left:8px;font-size:10px;color:var(--dad-muted)}.dad-result-failed{color:var(--dsw-alias-status-error,#bd3d3d)}.dad-results li p{font-size:11px;line-height:1.5;margin-top:4px;overflow-wrap:anywhere}
.dad-sort{display:flex;align-items:center;gap:6px;margin-left:auto}.dad-shell select{max-width:100%;min-height:30px;padding:4px 26px 4px 8px;border:1px solid var(--dad-border);border-radius:7px;background:var(--dsw-alias-bg-base,Canvas);color:var(--dad-primary);font:inherit}.dad-shell select:focus-visible{outline:2px solid var(--dsw-alias-button-primary-bg,#2878e0);outline-offset:2px}.dad-shell select:disabled{opacity:.55}
.dad-storage,.dad-storage-result,.dad-storage-categories{display:flex;flex-direction:column;gap:10px}.dad-storage-intro{display:flex;justify-content:flex-end;color:var(--dad-muted);font-size:11px}.dad-storage-controls{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.dad-storage-workspace{display:flex;align-items:center;gap:8px;flex:1;min-width:290px;flex-wrap:wrap}.dad-storage-workspace label{font-size:12px;color:var(--dad-muted)}.dad-storage-workspace select{flex:1;min-width:120px;max-width:330px}.dad-storage-workspace button{flex-shrink:0}.dad-storage-scanning{display:flex;align-items:center;justify-content:space-between;font-size:12px;color:var(--dad-muted)}.dad-storage-empty{min-height:100px}
.dad-storage-total{display:flex;flex-direction:column;align-items:flex-start;gap:5px;padding:14px 16px;border:1px solid var(--dad-border);border-radius:12px;background:var(--dsw-alias-bg-layer-1,#88805);font-size:12px}.dad-storage-total-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;margin-bottom:3px;font-weight:500}.dad-storage-total-heading>span:first-child{min-width:0;overflow-wrap:anywhere}.dad-storage-size-row{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}.dad-storage-size-row>span{color:var(--dad-muted);font-size:11px}.dad-storage-size{font-size:28px;font-weight:600;letter-spacing:-.5px;font-variant-numeric:tabular-nums}.dad-storage-partial{font-size:11px;color:var(--dad-muted)}.dad-storage h3,.dad-storage-result h3{font-size:12px;font-weight:600;margin:0 0 4px}.dad-storage-category{border-bottom:1px solid var(--dad-border);font-size:12px}.dad-storage-category>summary{display:flex;align-items:center;gap:8px;padding:10px 2px;list-style:none;cursor:pointer}.dad-storage-category>summary::-webkit-details-marker{display:none}.dad-storage-category>summary::before{content:'›';font-size:16px;color:var(--dad-muted);transform:rotate(0);width:10px;text-align:center}.dad-storage-category[open]>summary::before{transform:rotate(90deg)}.dad-storage-category>summary strong{flex:1;font-size:12px;font-weight:500;overflow-wrap:anywhere}.dad-storage-category>summary small{color:var(--dad-muted);font-size:10px;white-space:nowrap}.dad-storage-category-size{font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}.dad-storage-category-body{padding:2px 4px 12px 20px}.dad-storage-category-body h4{font-size:11px;margin:10px 0 4px;font-weight:500}.dad-storage-category-body .dad-storage-kinds{margin-bottom:12px}.dad-storage-kinds ul{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;list-style:none;padding:0;margin:0}.dad-storage-kinds li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 8px;padding:8px 10px;border:1px solid var(--dad-border);border-radius:8px;font-size:11px}.dad-storage-kinds li>span{overflow-wrap:anywhere}.dad-storage-kinds li>strong{font-size:11px;font-weight:500;font-variant-numeric:tabular-nums;white-space:nowrap}.dad-storage-kinds li>small{grid-column:1/-1;color:var(--dad-muted);font-size:10px}.dad-storage-project-files{padding:3px 0}.dad-storage-other{font-size:12px}.dad-storage-other>summary{display:flex;align-items:center;gap:8px;padding:8px 2px;cursor:pointer;color:var(--dad-muted)}.dad-storage-other>.dad-storage-categories{padding-left:8px}
.dad-storage-details{font-size:11px}.dad-storage-details summary{padding:5px 0;color:var(--dad-muted);cursor:pointer}.dad-storage-details summary:focus-visible,.dad-storage-category>summary:focus-visible,.dad-storage-other>summary:focus-visible{outline:2px solid var(--dsw-alias-button-primary-bg,#2878e0);outline-offset:2px;border-radius:4px}.dad-storage-scan-details{border-top:1px solid var(--dad-border);padding-top:5px}.dad-storage-scan-details>p{margin:5px 0}.dad-storage-category-notes h4{margin:10px 0 4px;font-size:11px;font-weight:500}.dad-storage-paths,.dad-storage-notes{list-style:none;margin:0;padding:0}.dad-storage-paths li{display:flex;align-items:baseline;gap:5px 10px;flex-wrap:wrap;border-bottom:1px solid var(--dad-border);padding:7px 0;font-size:11px}.dad-storage-paths li:last-child{border-bottom:0}.dad-storage-paths code{flex:1;min-width:100px;overflow-wrap:anywhere;font-size:11px}.dad-storage-paths small{width:100%;color:var(--dad-muted);font-size:10px}.dad-storage-paths li>span{font-variant-numeric:tabular-nums}.dad-storage-paths .dad-file-kind{font-size:10px;padding:1px 5px;border-radius:4px;background:var(--dsw-alias-bg-layer-1,#8881);color:var(--dad-muted);white-space:nowrap}.dad-storage-notes{color:var(--dad-muted)}.dad-storage-notes li{padding:2px 0;overflow-wrap:anywhere}.dad-storage-notes code{font-size:10px}
@media(prefers-reduced-motion:reduce){.dad-row,.dad-result-disclosure{transition:none}}
@media(max-width:560px){.dad-dialog{width:calc(100vw - 20px);max-width:calc(100vw - 20px)}.dad-content{max-height:65vh}.dad-toolbar{gap:8px}.dad-tabs button{padding:6px 9px}.dad-row{padding:10px;gap:8px}.dad-row-title{flex-wrap:wrap;gap:6px}.dad-list-foot{flex-direction:column;gap:6px}.dad-retention{font-size:10px}.dad-results summary{flex-wrap:wrap;gap:4px 9px}.dad-result-summary{flex-basis:75%}.dad-result-disclosure{margin-left:auto}.dad-workspace{max-width:100%}}
@media(max-width:560px){.dad-row[data-pending=true]{flex-wrap:wrap}.dad-row-actions{width:100%;flex-direction:row;flex-wrap:wrap;justify-content:flex-end}.dad-row-actions>button{max-width:100%}}
@media(max-width:560px){.dad-toolbar{flex-wrap:wrap}.dad-tabs{max-width:100%;flex:1}.dad-tabs button{justify-content:center;gap:5px;padding:6px 8px;flex:1;font-size:12px}.dad-list-heading{flex-wrap:wrap}.dad-sort{font-size:11px}.dad-retention{width:100%;justify-content:flex-end}.dad-storage-workspace{align-items:stretch}.dad-storage-workspace label{width:100%}.dad-storage-workspace select{min-width:0;max-width:none;width:100%;flex-basis:100%}.dad-storage-workspace button{width:100%}.dad-storage-total-heading{align-items:flex-start}.dad-storage-category>summary>.dad-badge{font-size:9px}.dad-storage-kinds ul{grid-template-columns:repeat(2,minmax(0,1fr))}.dad-storage-category>summary small{display:none}.dad-storage-workspace{min-width:0}}
`;
