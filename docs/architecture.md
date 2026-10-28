# Architecture

[简体中文](architecture.zh-CN.md) · English

## Intent and boundaries

The plugin provides one lifecycle: **archived → trash → archived again, or explicit permanent purge**. Its first target is official macOS DSH Desktop `0.2.1-rc.3` with the JSONL persistence backend.

DSH remains the authority for live sessions, workspaces, activity, and session history. Original log bytes remain the authority for a conversation. The plugin owns only its operation records, trash manifests, and native UI contributions. It does not install a replacement workspace registry, session backend, projection cache, or sidebar.

## Four modules

| Boundary | Responsibilities | Must not do |
| --- | --- | --- |
| `client` | Native menu item, management dialog, selection, preview, confirmation, localized results | Accept filesystem paths, guess a move succeeded, or mutate storage directly |
| `service` | Validate requested actions, inspect complete groups, serialize transitions, revalidate before execution, report partial results | Know undocumented host field layouts or perform unjournaled filesystem mutation |
| `dsh-adapter` | Exact-version capability admission, host lists/activity, explicit subagent relationships, canonical locations, compatible write leases, registration cleanup/restoration | Infer ownership merely from a supplied path or silently support unknown host generations |
| `storage` | Plugin-local manifests, durable operation stages, same-volume moves, recovery, confined purge | Recursively delete arbitrary paths, overwrite a conflicting source, or clean shared attachments |

Shared types live in the contracts module. The service depends on the adapter contract rather than importing the entire DSH runtime. Tests can therefore exercise the real storage transitions with synthetic adapters, while separate integration tests exercise the actual host boundary.

## UI and transport

An archived session's native row menu receives **Move to trash**. The plugin details page receives **Manage archives and trash**, opening a two-tab native dialog. This surface uses DSH components and module loading; React and DSH are provided by the host.

The browser sends requests to `/api/dsh-archive-delete` through DSH's authenticated connection gateway. The request vocabulary is deliberately small:

- `list`: support status, archived rows, trash rows, and recent operation results.
- `preview`: action (`trash`, `restore`, or `purge`) and selected IDs.
- `execute`: an opaque preview ID and request ID.
- `cancelPending`: selected session IDs and request ID.

The browser never supplies source or destination paths. Preview data describes the target, group members, size, and ready/pending/blocked disposition. The service rechecks authoritative state when executing; a preview does not grant permission to act on changed data.

Results distinguish `moved`, `pending`, `restored`, `purged`, `cancelled`, `skipped`, and `failed`. Batch counts are derived from per-item results. A pending request is not a successfully moved conversation.

## Persistence and host consistency

Plugin state is under `<DSH_HOME>/archive-delete/`: transition journals in `operations/`, in-progress moves in `staging/`, physical trash in `trash/`, and request progress/receipts in `receipts/`. The actual home comes from the running host. The trash must remain outside the session root and on the same volume.

A session group contains one selected parent and only its explicitly owned subagent descendants. A mere `parentSession` reference does not establish subagent ownership: independent forks also have parent relationships. Unknown or conflicting relationships block the group before any move.

Moving files and updating DSH bookkeeping are multiple operations, not one cross-system transaction. A durable request intent precedes mutation and receives per-target results. Its linked operation record captures progress and original registration data to reconcile a failed or interrupted transition. Completion proof remains until the request outcome is durable, closing the gap between committing files and replying to the browser. Group members are validated and locked before they move. Known host bookkeeping is updated through the adapter's serialized host write path, not by editing `workspace.json` directly.

The plugin does not keep a second full-text or projection mirror. Recovery metadata is retained while recovery is possible and removed with a purged trash entry. It does not store an extra copy of the conversation's first message for sidebar titles. Separate idempotency receipts retain request/target identifiers and operation outcomes, with conversation titles removed; these are not conversation backups.

Recovery JSON has the same 8 MiB read/write ceiling. Initial request intent is limited to 6 MiB, reserving room for up to 100 bounded per-target outcomes before any transition starts. Oversized metadata is rejected before a write/move and asks for a smaller batch; an admitted intent must remain writable as results accumulate.

## Compatibility policy

The initial version gate is exact, not a promise that all `0.2.x` releases are compatible. It checks the active profile's runtime installation anchor, rather than trusting the plugin's pinned peer package to identify its host. Mutation requires the supported host version, macOS, the JSONL backend, safe canonical roots, and usable activity/lease/registration capabilities. Failure to establish those conditions produces an explicit unsupported or blocked result.

Every access to an internal DSH shape belongs in the adapter. A future host change should require one explicit adapter update and real compatibility evidence, not a widened version range alone.

## Scope decisions

- No automatic trash expiry, background cleanup timer, or agent deletion tool.
- No forced session shutdown or write-lock stealing.
- No attachment garbage collection, spill cleanup, old third-party cache cleanup, project deletion, OCR, full-text search, or cross-agent migration.
- No custom plugin updater; installation/update remains with DSH's plugin manager.
- Opening the management list or preview does not mutate native session storage.

For the transition-by-transition rules, see [operations and recovery](operations.md). For the reference comparison, see [research](research.md).
