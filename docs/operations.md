# Operations and recovery

[简体中文](operations.zh-CN.md) · English

## States

| State | Location | Next action |
| --- | --- | --- |
| Archived | Original host logs | Preview and move |
| Pending restart | Original host logs, with a queued request | Review again, cancel, or wait for startup |
| Trash | Plugin trash with recovery metadata | Restore or permanently delete |
| Failed / skipped | Listed in the per-item result | Read the reason and retry the target |
| Purged | Selected logs and recovery metadata removed | Completed |

Batch results count successes, pending items, skips and failures separately. Damaged records have their own notice while healthy records remain listed.

## Confirmation

Preview resolves selected IDs into parent/subagent groups and displays size, members, ready/idle-release/protected counts and expiry. It lasts five minutes. Changes to content, registration or relationships require a new preview.

One preview authorizes one request. It is consumed before durable intent publication, including a publication error. The same request ID recovers the existing intent/result. Maintenance clears active previews and ignores late preview responses.

## Move and pending requests

1. Inspect the archived group and its activity.
2. For an idle host-managed writer, complete the native lifecycle release and inspect the group again.
3. Acquire member leases and persist the request/operation metadata.
4. Move member directories through staging, update native registration and commit the trash entry.
5. Persist per-item outcomes and finish terminal journals.

When a writer remains held, the request stays pending. **Cancel waiting and review** cancels that queue and opens a new preview. Cancelling or closing the preview leaves the original logs in place. Startup recovers interrupted operations, then checks each queued move once. Content changes or unarchiving end the old request and require another confirmation.

## Restore and permanent deletion

Restoration returns the group to its original workspace in archived state. A missing workspace becomes Ungrouped. Existing destinations produce a conflict for that target.

Permanent deletion works on selected trash entries in the current process. It removes their logs and recovery metadata and cannot be undone. A partial deletion reports the remaining state and supports a new explicit retry; only a complete remaining group can be restored.

## Journal recovery

| Recorded phase | Startup handling |
| --- | --- |
| `moving` / `detached` / `trashed` | Reconcile the committed trash entry, or roll staging back to the original locations |
| `restoring` | Roll the incomplete restore back to trash |
| `restored-metadata` / `restored` | Complete host registration and trash cleanup |
| `purging` / `purged` | Finish an empty entry; report remaining files for explicit retry |
| `pending` | Recheck the original group and attempt its queued move once |

Recovery checks observed paths and leases against recorded ownership. A missing original empty bucket is accepted for recorded cleanup; conflicting or unreadable data produces a diagnostic. Keep the affected entry and journals together when reporting an issue.

Completed request receipts retain IDs/outcomes for replay. Listing reads recent results through a cached index; startup explicitly cleans temporary receipt files.

## Storage observations

Storage scans have their own cancellation lifetime. They carry observation time, complete/partial status, category/type totals and skipped-entry details. Same-scope rescans keep the previous result until replacement; changing scope clears it. Cancelling a scan affects the scan only.

## Update recovery

| Status | Action |
| --- | --- |
| `installing` | Wait for the native manager; status observation continues |
| `installed` | The target is installed; load it with a full restart if prompted |
| `restart-required` | Fully quit and reopen DSH |
| `failed` | Read the diagnostic, check the installed version and review a new attempt |
| `interrupted` | Recheck the release and current installation |
| `unknown` | Check installation status or recheck the confirmed request; fully restart if unresolved |

Check and installation journals are profile-scoped under `updates/`; verified packages stay in `updates/packages/`. Same-request checks read native installation state without repeating a recorded manager call. Polling backs off from 3 to 15 to 60 seconds.

Before replacement, archive work drains and new mutations pause. Unloading cancels verification before delegation; the native manager owns an admitted installation. Startup reconciles the saved target with the installed and loaded versions.

[Installation and troubleshooting](installation.md) · [Architecture](architecture.md) · [Verification](acceptance.md)
