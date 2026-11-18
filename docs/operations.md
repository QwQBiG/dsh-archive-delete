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

Batch results show separate counts for successful, pending, skipped and failed targets. A damaged record gets its own notice, while healthy records remain in the list.

Refreshing updates the displayed outcome from the same request receipt, including a cancellation in another window or startup processing. Other requests do not replace the local result.

## Confirmation

The preview expands the selected IDs into parent/subagent groups and shows their members, size and expiry, along with counts for ready, idle-release and protected targets. It lasts five minutes. If content, registration or relationships change, review a new preview.

Each preview authorizes one request. The service marks it used before publishing the durable intent, so a publication error leaves it used. Retrying with the same request ID recovers the existing intent and result. During maintenance, the client clears active previews and ignores preview responses that arrive later.

An error after the request may have been recorded keeps the outcome unconfirmed. Use **Retry the same request**; a temporary refusal during retry keeps the original request available. If the service verifies that neither its receipt nor an associated operation exists, it returns to preview review instead.

## Move and pending requests

1. Check the archived group and its activity.
2. If DSH holds an idle writer, release it through its native lifecycle and check the group again.
3. Acquire member leases and persist the request and operation metadata.
4. Move member directories through staging, update native registration and commit the trash entry.
5. Persist each result and remove the completed operation journals.

If the writer remains held, the request stays pending. Choose **Cancel waiting and review** to cancel the queued request and open a new preview. Cancelling or closing that preview leaves the original logs in place. At startup, the plugin recovers interrupted operations and cancellations before checking each remaining queued move once. Changed content or an unarchived conversation ends the old request and requires a new confirmation.

Cancellation records the exact queued operation IDs. If it is interrupted, startup finishes cancelling those operations; later confirmations for the same conversation remain separate. A cancellation from an older build may lack these IDs. In that case, the affected queued move stays paused until you confirm cancellation again. Other queued conversations can still proceed.

## Restore and permanent deletion

Restore returns the group to its original workspace in archived state, or to Ungrouped if the workspace is missing. If a destination already exists, that target reports a conflict.

If an empty internal session bucket was removed while its logs were in trash or staging, restore or rollback recreates that bucket under the existing session-storage root. Project folders are not recreated.

Permanent deletion runs on the selected trash entries in the current process. It removes their logs and recovery metadata and cannot be undone. If deletion stops partway through, the result describes what remains so you can review and retry. Restore is available only when the remaining group is complete.

## Recent permanent deletions

Expand **Recent permanent deletions** in Trash to see the session ID, confirmed completion time, original log size and member count for up to 200 deletions from the last 30 days. The view can read existing history even if archive operations are unavailable. The active store removes expired records when it reads or writes the history.

An interrupted history write may leave a gap. If startup recovery confirms a deletion, the recorded time is when recovery confirmed it.

## Journal recovery

| Recorded phase | Startup handling |
| --- | --- |
| `moving` / `detached` / `trashed` | Reconcile the committed trash entry, or roll staging back to the original locations |
| `restoring` | Roll the incomplete restore back to trash |
| `restored-metadata` / `restored` | Complete host registration and trash cleanup |
| `purging` / `purged` | Finish an empty entry; report remaining files for explicit retry |
| `pending` | Recheck the original group and attempt its queued move once |

Recovery compares the paths and leases it finds with the recorded ownership. For recorded cleanup, it accepts a missing original empty bucket. Conflicting or unreadable data produces a diagnostic. When reporting an issue, keep the affected entry together with its operation journals.

Completed request receipts keep IDs and outcomes for replay. The list rereads the displayed contents each time and caches their order for up to one minute. The first lookup after expiry refreshes the order. Startup also cleans temporary receipt files.

## Storage observations

Each storage scan can be cancelled independently of other operations. Its result includes the observation time, complete or partial status, category and file-type totals, and skipped entries. Rescanning the same scope keeps the previous result until a new one arrives; changing scope clears it. Cancelling the scan leaves other operations running.

## Update recovery

| Status | Action |
| --- | --- |
| `installing` | Wait for the native manager; the plugin keeps checking its status |
| `installed` | The target is installed; fully restart to load it if prompted |
| `restart-required` | Fully quit and reopen DSH |
| `failed` | Read the diagnostic, check the installed version and review another attempt |
| `interrupted` | Recheck the release and current installation |
| `unknown` | Check installation status or recheck the confirmed request; fully restart if unresolved |

Check and installation journals are stored separately for each profile under `updates/`, and verified packages stay in `updates/packages/`. Rechecking the same request reads the native installation state without repeating a recorded manager call. The polling interval increases from 3 to 15 to 60 seconds.

Before package replacement, the plugin finishes queued archive work and pauses new mutations. Unloading cancels verification that has not yet been delegated; once the native manager accepts an installation, it controls the remaining work. At startup, the plugin compares the saved target with the installed and loaded versions.

Each confirmed installation keeps its own receipt across later attempts and restarts. Rechecking an older request returns its recorded outcome; an active or unresolved newer installation keeps archive changes paused. Existing latest-only installation records migrate on startup.

[Installation and troubleshooting](installation.md) · [Architecture](architecture.md) · [Verification](acceptance.md)
