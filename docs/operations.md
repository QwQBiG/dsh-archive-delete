# Operation states and crash recovery

[简体中文](operations.zh-CN.md) · English

## User-visible states

| State | Meaning | Available next action |
| --- | --- | --- |
| Archived | Original logs remain in the host store | Preview and move to trash |
| Pending move to trash | User confirmed, but the host still owns the writer and safe immediate release was unavailable | Cancel waiting and review a fresh move, cancel the request, or let the next startup recheck it |
| Trash | Logs have moved to plugin-owned trash and host bookkeeping has settled | Restore or preview permanent purge |
| Failed / skipped | The requested transition did not complete for this item; the reason is visible | Inspect, then retry the specific failed target |
| Purged | Selected trash logs and their recovery metadata are permanently removed | No restoration |

Batch feedback reports moved/restored/purged successes, pending requests, skipped items, and failures separately. The dialog must not label a pending item as deleted or claim reclaimed space before files move.

## Preview and execution

Preview resolves selected IDs on the host, groups explicit subagents, and reports the actual scope. It is read-only. Execution uses an opaque preview identity and a request identity, rechecking archive state, contents, relationships, activity, paths, and lease ownership.

The service serializes mutations. It persists request intent before starting and records each target's outcome durably. Reusing a request identity reads its recorded outcome instead of starting another transition; a completed pending request can later receive the startup move's outcome. A failed member must not disappear from the retryable result merely because another member or bookkeeping update succeeded.

## Move to trash

1. Resolve the complete parent/subagent group and capture restore metadata.
2. Reject unarchived parents, active work/interactions, unsafe or ambiguous storage, and external write ownership.
3. During a fresh manual execution, if the blocker is idle ownership by this host, attempt the admitted native lifecycle teardown for the complete group. Do not close active work, maintenance, queued input, unknown ownership, or externally held writers.
4. After a successful release, re-inspect content, archive state and membership, then acquire compatible exclusive leases and revalidate the group. Changed data requires another confirmation. If safe release is unavailable, persist a pending request without moving any log.
5. Persist the prepared operation, then use same-volume moves for owned session-log directories.
6. Settle the corresponding host registration and projection metadata through the adapter, and publish a complete trash entry.
7. Release leases and report the exact result. A failed intermediate stage is recorded for rollback/recovery, not reported as moved.

Lease identities follow the host on each platform: flock on macOS, and path-named kernel semaphores on Windows. Windows transitions reserve the original and relocated paths together, including the original destination during restoration. No lock is forcibly stolen.

The operation record makes progress recoverable; it does not turn several filesystem and host writes into a single atomic transaction. A crash at each stage must be reconciled from recorded progress and observed paths, never from an assumed successful return value.

## Pending requests

Pending requests remain in the Archived tab. A request can be cancelled before the transition starts; cancellation and execution use the same serialized operation path. **Cancel waiting and review** ends the old queued request and opens a new move preview. It does not execute a move or purge. Closing/cancelling that preview leaves the old queue cancelled and source logs intact; another confirmation is required to attempt processing now. An uncertain cancellation must be reconciled first.

At plugin startup, recover interrupted transitions first, then attempt each pending move once. Recheck content revisions, archive state, subagent membership, paths, activity, and write leases. A session that changed or was unarchived requires a new confirmation. A still-held lease remains pending. Startup replay does not invoke the fresh-manual idle-release capability. There is no timer, background polling, forced interruption of active work, or lock stealing.

## Restore

Restore revalidates the trash manifest and every member before moving. It refuses existing destination conflicts instead of overwriting or renaming a conversation into a new identity.

Return the parent to its original workspace and archived state. If the workspace registration is gone, restore as an archived Ungrouped conversation; do not recreate a project directory. Restore the explicitly owned subagents with their original identities. Independent forks were never moved.

After successful host registration, remove the completed trash entry's recovery metadata. An interrupted restore remains recoverable and must not show as a complete restore.

## Permanent purge

Only existing trash entries can be purged. A second explicit preview/confirmation identifies the selected parent and child logs. Confirmation executes permanent purge in the current process; restarting the host is not a prerequisite. After a safe immediate move succeeds, its new trash entry can be purged in that same process. Purge removes only verified, plugin-owned trash artifacts and the associated recovery metadata, including stored titles. Unknown files or unsafe paths block the action.

Permanent purge cannot undo bytes already removed. If it fails part-way, preserve and report the incomplete state and retry information; never offer a complete restore of a partly purged group.

No automatic expiry or empty-trash task is installed. Shared attachments, spill files, project working directories, third-party caches, and remote copies are outside the operation.

## Size observations and storage scans

Archived and Trash can be sorted in default order or largest first. Changing sort, page or tab clears selection. Trash row/preview sizes and the confirmation fingerprint come from a current checked observation of remaining owned files; saved original sizes do not describe a partial purge. Recovery metadata and lock files are outside the row figure. Both restore and purge recheck the fingerprint under the native lease before mutation. A changed observation requires another confirmation, not an adjusted old one.

**Storage overview** is a separate read-only flow: choose DSH storage or one registered workspace, explicitly start a scan, then view its measured categories, files, folders, time and limits. Opening it does not scan files. DSH scans exclude valid registered project directories even below the data home; projects require their own explicitly selected scan. Refreshing the workspace list does not refresh measured sizes. There is one active scan at a time; cancellation, scope changes and closing prevent late results from replacing the current view. An incomplete or unavailable scan is not a failed archive operation and does not change pending requests or recovery journals.

The result measures logical file bytes. Verified path/hard-link identities are globally counted once; folder totals count aliases and overlapping subtotals are not additive. Missing/unavailable categories remain unknown. Metadata can change during scanning, so partial sizes and observation timestamps are retained. A result never represents reclaimed physical space, proves AI origin or authorizes deleting a file. There is no storage-category purge, project cleanup, automatic scan or receipt expiry; permanent mutation still requires the existing Trash preview and confirmation.

## Recovery expectations

| Interrupted boundary | Required observation and outcome |
| --- | --- |
| Before a prepared record is durable | No log has moved |
| Prepared, before first move | Original logs remain; retry/recovery has a complete target description |
| Between group-member moves | Record both original and trash locations; reconcile the entire group before accepting new mutations |
| Logs moved, host registration incomplete | Preserve recoverable logs and original registration metadata; do not publish false success |
| Trash committed, response lost | Listing shows one trash entry; repeating the request does not move again |
| Restore interrupted | Do not overwrite either location; reconcile from recorded progress |
| Purge interrupted | Display the actual partial state and permit a specific retry; no false restoration promise |

Recovery is confined to this plugin's operation records. It does not sweep unrelated host or third-party files. See [acceptance](acceptance.md) for the concrete fault-injection checks.
