# Architecture

[简体中文](architecture.zh-CN.md) · English

The plugin supports DSH Desktop `0.2.1-rc.3`, `0.2.1-rc.5` and `0.2.2-rc.3` on macOS and Windows with JSONL persistence. It uses the host's React instance, native controls, session storage, workspace registry and activity/lease services.

## Modules

| Module | Responsibility |
| --- | --- |
| `client` | Native entries, selection, previews, confirmation and results |
| `service` | Group validation, serialized transitions, requests and recovery |
| `dsh-adapter` | Host admission, relationships, activity, leases and native bookkeeping |
| `storage` | Trash manifests, operation journals, moves, restoration and purge |
| `host-diagnostics` | Shared read-only probe contracts, check labels and refusal codes |
| `purge-history` | Bounded informational records of completed permanent deletions |
| `storage-inspector` / `storage-usage` | Source resolution and bounded metadata scans |
| `update-source` / `update-service` / `update-host` | GitHub verification, update state and native profile installation |

Access to DSH internals stays in the adapter. Changes for a new host version belong there, alongside the native integration tests that verify them.

## API and client state

Requests go through the owner-authenticated `/api/dsh-archive-delete` route, which accepts a JSON stream of up to 64 KiB.

| Action | Input | Result |
| --- | --- | --- |
| `list` | — | Support, archives, trash, recent results, diagnostics and workspace choices |
| `preview` | Action and target IDs | Group members, size, disposition and expiry |
| `execute` | Preview ID, request ID | Per-target results and counts |
| `cancelPending` | Session IDs, request ID | Cancellation results |
| `storage` | Optional workspace ID | Storage observation |
| `updates` | Force-check flag | Release and installation status |
| `installUpdate` | Candidate ID, request ID | Installation status |

The server resolves file paths and release assets. The client validates responses and uses request generations to distinguish new responses from late ones. If a mutation's outcome is unclear, it checks again with the same request ID. Changing the tab, page or sort order clears selection; maintenance invalidates previews still in flight. The current preview supplies the confirmation expiry and the counts for ready, idle-release and protected targets.

Archive mutation errors can carry an optional `error.uncertain` boolean:

| Value | Meaning |
| --- | --- |
| `true` | Intent publication or later processing may have occurred; retry the original request ID. |
| `false` | A validated lookup found no receipt or related operation for the expired preview's request; a new preview can be reviewed. |
| Omitted | The error makes no statement about a previous attempt's outcome. |

The service marks exceptions after possible durable admission as unconfirmed. A temporary refusal during replay keeps the earlier uncertainty. For older servers, `operation-failed` mutation errors are treated as unconfirmed. Read errors and recorded per-item outcomes retain their existing behavior.

## Data and transitions

The plugin acquires the store lease before initializing its data directories. State lives under `<DSH_HOME>/archive-delete/`:

| Path | Contents |
| --- | --- |
| `trash/<entry>/` | Manifest and numbered member-log directories |
| `staging/<entry>/` | In-progress group moves |
| `operations/` | Durable transition phases and recovery data |
| `receipts/` | Request progress and idempotency outcomes |
| `purge-history/history.json` | Up to 200 completed-deletion records from the last 30 days |
| `updates/` | Profile-scoped check/installation journals |
| `updates/packages/` | Verified packages referenced by profile dependencies |

A group contains a parent conversation and its explicitly owned subagent descendants. Forks also carry a parent pointer, so the adapter uses the host's relationship metadata to distinguish them. Each listing builds one relationship index. Damaged identities produce diagnostics and protect known related groups; if ancestry cannot be located, archive moves are blocked.

Operations run serially, and overlapping refreshes share one listing task. The service marks a preview as used before recording the request intent. It persists that intent before changing files, then persists each result before removing the corresponding completed operation journal. The original request ID can recover the recorded intent and results.

Moves stay on the same volume and preserve the original log bytes. The adapter updates workspace and projection records after the file transitions. Restore returns a conversation to its original workspace in archived state, or to Ungrouped if the workspace registration is missing. Confirmed purge removes the selected trash logs and recovery metadata.

Before moving logs into staging, the store syncs the staging entry's parent directory. Purge syncs member-file removals, member-directory removals and manifest removal in order, then syncs the trash parent and terminal journal. POSIX uses directory fsync. Windows supports recovery from process interruption; durability after whole-machine power loss is not guaranteed. Deletion rechecks owned directory identities immediately before removing paths.

Completed receipts keep identifiers and outcomes, with titles removed. The recent-result cache holds ten completed records and validates their contents on every read. Its ordering index expires after one minute; the next read picks up in-place edits even if the directory identity has not changed. Initial inventory and startup recovery take longer as history grows. Startup also cleans temporary files.

## Native lifecycle and leases

A confirmed manual move can release a fully idle group held by DSH through the native AgentLoop lifecycle. The adapter checks ownership, queued input, maintenance, active tasks and child agents. After release, the service checks the group's members and content again, then acquires the normal leases before moving it. A pending request gets one attempt at startup. Reviewing it manually opens a fresh immediate-release attempt.

When comparing session headers, the adapter treats an omitted `delegationDepth` as the persisted default `0`. It rechecks the other values and session identities as recorded.

When idle release is unavailable, the adapter logs a fixed reason code and host version. It logs each reason once until a verified release succeeds, then logs any recurrence. Missing-owner diagnostics include counts of fibers, effects and lifecycle-label-prefix matches. Active work is reported through the normal per-item result.

The management listing runs a read-only probe that shares the release code's runtime and owner checks. Each check reports pass, fail or untested. An empty runtime leaves session-specific checks untested, and an unexpected probe error returns an unverified report. The probe reads structure without flushing or disposing sessions, invoking activity hooks or changing files. Actual operations still require a supported version and fresh activity and identity checks for the selected group.

macOS uses the host's flock handles. Windows uses the host JSONL semaphore names and reserves both original and relocated paths. Canonical local paths keep lease identities aligned. The plugin holds its store lease for the process lifetime to coordinate recovery and file operations.

## Purge history

Purge history is kept separately from request receipts and recovery data. Once purge completes durably, normal execution or recovery attempts an atomic update to a private history file before removing the operation journal. Each entry stores the entry/session IDs, a title hash, original log size, member count, first confirmed completion time and optional request ID. Plaintext titles, paths and session content are excluded. Replay preserves the first record. The active store prunes expired entries, with retention limited to 200 entries from the last 30 days. If archive operations are unavailable, the API can still show recent history through a read-only path. A history failure logs a fixed diagnostic without changing the deletion result, so interrupted or failed writes can leave gaps. When recovery confirms completion, that time may be later than the actual file removal.

## Storage observations

The adapter resolves DSH's configured storage roots and registered workspaces. A DSH scan excludes project directories and descendants counted in separate categories. After a workspace scan, the inspector rechecks its registration and path and compares the exclusion sets. Containment uses physical paths when configured locations have different ancestor aliases, including the checks that distinguish projects from host storage.

The search-index category includes the configured SQLite database and its existing `-wal`, `-shm` and `-journal` files, including locations outside DSH home. It measures these exact files without scanning their parent directory.

The scanner reads metadata within three limits: 50,000 entries, a depth of 32 and a 5-second inspector budget. It yields between batches, accepts cancellation and records entries that were skipped, changed or unavailable. Results include the observation time and whether the scan was complete or partial.

The main total counts each canonical path and verified file identity once. Category totals may overlap, while folder totals count file paths. Directory names and extensions determine the file-type breakdown: dependencies, build folders, version-control data, logs, media, archives, code/configuration, documents and other files. Type subtotals deduplicate within each category, and each large-file row shows its type.

The storage view starts with compact category summaries. Users can expand them for file types, large files and folders. Rescanning the same scope keeps the previous result and timestamp visible until the new result arrives; changing scope clears it.

Wire paths use `/` separators; native POSIX filenames retain literal colons and backslashes when displayed and classified. These paths are display data, while archive actions accept IDs.

## GitHub updates

The updater reads newer stable releases from `QwQBiG/dsh-archive-delete`, examining at most 20 releases and five newer candidates. Candidates must declare the exact DSH version and platform. Release discovery is cached for 24 hours. Manual checks are at least one minute apart; failed checks wait at least one hour and respect longer GitHub backoff periods.

The server pins the release and asset identities, version, size and SHA-256 before installation. Source operations share a 15-second network budget, and installation preflight has a 30-second total budget. The package validator limits compressed and expanded data and tar entries, checks paths and the package manifest, and requires precompiled files. SHA-256 checks that the bytes match the package obtained from the repository through TLS/GitHub.

Verified packages stay in `updates/packages/`. DSH's manager replaces the existing bundle in the current profile, with check and installation journals separated by a hash of the canonical profile directory. Before replacement, the archive queue finishes its current work. Installation runs outside that queue so the plugin can finish unloading itself.

Unloading cancels release discovery and preflight. Once installation has been delegated to the native manager, the manager controls its lifetime. Rechecking the same request reads native installation state without repeating a recorded installation. Checks back off from 3 to 15 to 60 seconds; the running and installed versions determine whether the update is active or needs a restart.

The package declares its supported hosts in `engines.dsh` as a bounded list of exact versions. The default update asset covers `0.2.1-rc.3`. Each other supported version has a host-specific asset pointing to the same package and checksum. To read a runtime manifest inside ASAR, the manifest reader also validates the containing archive.

Each admitted request also has an atomic `<profile-hash>.<request-id>.request.json` receipt bound to its candidate and version. Publication writes this receipt, then the latest-state file, before calling the manager. Outcomes are saved to the request receipt first; startup uses that receipt if updating the latest-state copy was interrupted, and migrates legacy latest-only records. Replaying an older receipt leaves the latest state unchanged. Receipts are retained to keep old request IDs consumed, and lookups read only the requested file.

## Package and diagnostics

The Release `.tgz` contains the files selected by the package's `files` allowlist, including compiled `lib/` files. The artifact generator uses the runtime package validator. The checker verifies that `.tgz.sha256`, `.update.json` and the package bytes agree, then exercises release discovery and download fixtures.

After recovery and API registration, startup logs the plugin version, host and trash path. The packaged Doctor checks profile registration, package files and access offline. See [installation commands](installation.md), [state recovery](operations.md) and [verification](acceptance.md) for details.

Doctor's `--codes` mode lists the refusal codes in the chosen language without inspecting a profile. From a source checkout, `scripts/probe-host.mts` starts stock services in its own temporary directory and produces a JSON report that omits user paths and session data. It opens no user profile and creates no sessions, so owner checks remain untested. CI keeps a report for each host/platform combination. Data operations remain disabled on undeclared versions even when structural checks pass.
