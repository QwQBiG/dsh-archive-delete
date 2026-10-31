# Architecture

[简体中文](architecture.zh-CN.md) · English

The plugin targets DSH Desktop `0.2.1-rc.3` / `0.2.1-rc.5` on macOS and Windows with JSONL persistence. DSH supplies React, native controls, session persistence, workspace registration and activity/lease services.

## Modules

| Module | Responsibility |
| --- | --- |
| `client` | Native entries, selection, previews, confirmation and results |
| `service` | Group validation, serialized transitions, requests and recovery |
| `dsh-adapter` | Host admission, relationships, activity, leases and native bookkeeping |
| `storage` | Trash manifests, operation journals, moves, restoration and purge |
| `storage-inspector` / `storage-usage` | Source resolution and bounded metadata scans |
| `update-source` / `update-service` / `update-host` | GitHub verification, update state and native profile installation |

The adapter contains access to host internals. Compatibility changes require updating that boundary and its native integration tests.

## API and client state

The owner-authenticated `/api/dsh-archive-delete` route accepts a JSON stream capped at 64 KiB.

| Action | Input | Result |
| --- | --- | --- |
| `list` | — | Support, archives, trash, recent results, diagnostics and workspace choices |
| `preview` | Action and target IDs | Group members, size, disposition and expiry |
| `execute` | Preview ID, request ID | Per-target results and counts |
| `cancelPending` | Session IDs, request ID | Cancellation results |
| `storage` | Optional workspace ID | Storage observation |
| `updates` | Force-check flag | Release and installation status |
| `installUpdate` | Candidate ID, request ID | Installation status |

The server resolves paths and release assets. The client validates response fields, tracks request generations and reconciles uncertain mutation replies with the same request ID. Tab/page/sort changes clear selection. Maintenance invalidates in-flight previews. Confirmation expiry and ready/idle-release/protected counts come from the current preview.

## Data and transitions

The store lease is acquired before data-area initialization. State lives under `<DSH_HOME>/archive-delete/`:

| Path | Contents |
| --- | --- |
| `trash/<entry>/` | Manifest and numbered member-log directories |
| `staging/<entry>/` | In-progress group moves |
| `operations/` | Durable transition phases and recovery data |
| `receipts/` | Request progress and idempotency outcomes |
| `updates/` | Profile-scoped check/installation journals |
| `updates/packages/` | Verified packages referenced by profile dependencies |

A group contains a parent and explicit subagent descendants. A parent pointer alone also occurs on forks, so ownership uses the host's relationship metadata. Listing builds the relationship index once. Damaged identities produce diagnostics; known related groups stay protected, and unlocatable ancestry blocks archive moves.

Transitions run serially. Overlapping refreshes share one listing task. A preview is consumed before durable request admission; its original request ID can recover intent/results. The intent precedes file mutation and each outcome is persisted before the corresponding terminal operation is retired.

Moves use the same volume and preserve original log bytes. The adapter applies workspace/projection bookkeeping after file transitions. Restoration uses the original archived state and workspace, with Ungrouped as the fallback for missing registration. Purge removes the selected trash logs and recovery metadata after confirmation.

The staging parent entry is synced before logs move into it. Purge syncs member-file removals, member-directory removals and manifest removal before the trash parent and terminal journal. POSIX uses directory fsync; Windows provides process-interruption recovery without a whole-machine power-loss guarantee. Path-based deletion rechecks owned directory identities immediately before removal.

Completed receipts retain identifiers/outcomes with titles removed. Recent-result lookup uses a warm index of ten completed records and validates displayed receipts. Initial inventory and startup recovery scale with history. Temporary-file cleanup runs explicitly at startup.

## Native lifecycle and leases

A confirmed manual move can release a wholly idle host-managed group through the native AgentLoop lifecycle. Admission checks ownership, input, maintenance, active tasks and children. The service then re-inspects membership/content and takes normal leases before moving. Pending requests get one startup attempt; manual re-review provides a fresh immediate-release attempt.

Header comparisons normalize the host's omitted `delegationDepth` to its persisted default `0`. Other values and session identities remain part of revalidation.

macOS uses host flock handles. Windows uses the host JSONL semaphore names and reserves original plus relocated paths. Canonical local paths keep lease identities aligned. The plugin-store lease covers recovery and transition ownership for the process lifetime.

## Storage observations

The adapter resolves configured DSH roots and registered workspaces. DSH scans exclude project directories and separately categorized descendants. Workspace scans recheck the selected registration/path and compare exclusion sets after scanning.

The scanner reads metadata through bounded directory traversal: 50,000 entries, depth 32 and a 5-second inspector budget. It yields between batches, supports cancellation and records skipped/changed/unavailable entries. The result carries its observation time and complete/partial status.

The main total deduplicates canonical paths and verified file identities. Category totals may overlap; folder totals count file paths. File-type breakdowns use directory-component and extension rules for dependencies, build folders, version-control data, logs, media, archives, code/configuration, documents and other files. Type subtotals deduplicate within each category. Each large-file row includes its type.

Storage UI shows compact category summaries, then file types, large files and folders on demand. A same-scope rescan keeps the previous timestamped observation while updating; a scope change clears it.

## GitHub updates

The source reads stable newer releases from `QwQBiG/dsh-archive-delete`, considers at most 20 releases and five newer candidates, and requires the exact DSH/platform declaration. Discovery caches for 24 hours; manual checks have a one-minute minimum, failures wait at least one hour and follow GitHub backoff.

A server-owned pin binds release/asset identity, version, size and SHA-256. Source operations share a 15-second network budget; installation preflight has a 30-second total budget. The package validator bounds compressed/expanded data and tar entries, checks paths and the package manifest, and requires precompiled artifacts. SHA-256 verifies consistency with the TLS/GitHub repository source.

Confirmed bytes are retained in `updates/packages/`. DSH's manager replaces the same bundle in the current profile. Check and installation journals use a hash of the canonical profile directory. The archive queue drains before replacement; the install task remains outside that queue so self-unloading can complete.

Disposal cancels discovery/preflight. A delegated native installation keeps its own lifetime. Same-request rechecks inspect native installation state without replaying a recorded install. Observation intervals back off from 3 to 15 to 60 seconds. Running and installed versions determine activation/restart state.

The package declares its primary DSH version and the exact supported versions in `dshArchiveDelete.supportedDshVersions`. Release metadata has a default asset for the primary version and an exact-host asset for each additional version. Both select the same package and checksum. Installed ASAR runtime manifests use a reader that validates the containing archive.

## Package and diagnostics

The Release `.tgz` includes the `files` allowlist and compiled `lib/` artifacts. The artifact generator uses runtime package admission; the checker binds `.tgz.sha256`, `.update.json` and actual bytes before exercising discovery/download fixtures.

Startup logs version, host and trash path after recovery/API registration. Packaged Doctor checks offline registration, artifacts and access. [Installation commands](installation.md), [state recovery](operations.md) and [verification](acceptance.md) describe their use.
