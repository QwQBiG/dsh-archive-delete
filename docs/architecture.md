# Architecture

[简体中文](architecture.zh-CN.md) · English

## Intent and boundaries

The mutation lifecycle remains: **archived → trash → archived again, or explicit permanent purge**. It targets official DSH Desktop `0.2.1-rc.3` with the JSONL persistence backend. Both macOS and Windows are supported, with native host and package lifecycle checks on each platform.

DSH remains the authority for live sessions, workspaces, activity, and session history. Original log bytes remain the authority for a conversation. The plugin owns only its operation records, trash manifests, and native UI contributions. It also offers bounded, read-only inspection of host-configured storage and a manually selected registered workspace. It does not install a replacement workspace registry, session backend, projection cache, or sidebar.

## Four modules

| Boundary | Responsibilities | Must not do |
| --- | --- | --- |
| `client` | Native menu item, management dialog, selection, preview, confirmation, localized results | Accept filesystem paths, guess a move succeeded, or mutate storage directly |
| `service` | Validate requested actions, inspect complete groups, serialize transitions, revalidate before execution, report partial results | Know undocumented host field layouts or perform unjournaled filesystem mutation |
| `dsh-adapter` | Exact-version capability admission, host lists/activity, explicit subagent relationships, canonical locations, compatible write leases, native idle-release admission, registration cleanup/restoration, trusted storage-source resolution | Infer ownership merely from a supplied path or silently support unknown host generations |
| `storage` | Plugin-local manifests, durable operation stages, same-volume moves, recovery, confined purge, a separate metadata-only usage scanner | Recursively delete arbitrary paths, overwrite a conflicting source, or clean shared attachments |

Shared types live in the contracts module. The service depends on the adapter contract rather than importing the entire DSH runtime. Tests can therefore exercise the real storage transitions with synthetic adapters, while separate integration tests exercise the actual host boundary.

## UI and transport

An archived session's native row menu receives **Move to trash**. The plugin details page receives **Manage archives, trash and storage**, opening an Archived / Trash / Storage overview native dialog. This surface uses DSH components and module loading; React and DSH are provided by the host.

The browser sends requests to `/api/dsh-archive-delete` through DSH's authenticated connection gateway. The request vocabulary is deliberately small:

- `list`: support status, archived rows, trash rows, recent operation results, and registered workspace IDs/titles.
- `preview`: action (`trash`, `restore`, or `purge`) and selected IDs.
- `execute`: an opaque preview ID and request ID.
- `cancelPending`: selected session IDs and request ID.
- `storage`: no workspace ID for configured DSH storage, or one currently registered workspace ID. No client-selected path or scan limit is accepted.

The browser never supplies source or destination paths. Preview data describes the target, group members, size, and ready/pending/blocked disposition. The service rechecks authoritative state when executing; a preview does not grant permission to act on changed data.

Results distinguish `moved`, `pending`, `restored`, `purged`, `cancelled`, `skipped`, and `failed`. Batch counts are derived from per-item results. A pending request is not a successfully moved conversation.

## Persistence and host consistency

Plugin state is under `<DSH_HOME>/archive-delete/`: transition journals in `operations/`, in-progress moves in `staging/`, physical trash in `trash/`, and request progress/receipts in `receipts/`. The actual home comes from the running host. The trash must remain outside the session root and on the same volume.

A session group contains one selected parent and only its explicitly owned subagent descendants. A mere `parentSession` reference does not establish subagent ownership: independent forks also have parent relationships. Unknown or conflicting relationships block the group before any move.

Moving files and updating DSH bookkeeping are multiple operations, not one cross-system transaction. A durable request intent precedes mutation and receives per-target results. Its linked operation record captures progress and original registration data to reconcile a failed or interrupted transition. Completion proof remains until the request outcome is durable, closing the gap between committing files and replying to the browser. Group members are validated and locked before they move. Known host bookkeeping is updated through the adapter's serialized host write path, not by editing `workspace.json` directly.

The plugin does not keep a second full-text or projection mirror. Recovery metadata is retained while recovery is possible and removed with a purged trash entry. It does not store an extra copy of the conversation's first message for sidebar titles. Separate idempotency receipts retain request/target identifiers and operation outcomes, with conversation titles removed; these are not conversation backups.

Recovery JSON has the same 8 MiB read/write ceiling. Initial request intent is limited to 6 MiB, reserving room for up to 100 bounded per-target outcomes before any transition starts. Oversized metadata is rejected before a write/move and asks for a smaller batch; an admitted intent must remain writable as results accumulate.

## Read-only storage inspection

The adapter resolves storage sources from the running exact-version host: JSONL persistence, attachment and attachment-cache roots, spill root, JSON settings backend root, configured search-index file, and DSH-home paths for plugin state, cache, profiles and other host data. It does not assume every source lives below DSH home or initialize a missing provider. The SQLite source measures only the configured regular file, never its parent directory. Valid registered project paths are also excluded from a DSH scan, including projects below DSH home; inspecting those files requires a separate explicit workspace scan. Resolving these exclusions only enumerates registry metadata. Known descendant roots are excluded from their parents; overlapping roots and verified duplicate identities remain disclosed and globally deduplicated.

Workspace enumeration reads only the registry. A scan re-resolves a single registered ID, rejects drive roots, the user home or its ancestors, unsafe redirects and internal protected host storage, and excludes known host-data descendants of an admitted project. Membership/path are re-read after scanning; stale registration cannot silently change the target. Server-owned paths stay behind the authenticated API. Listing workspaces and opening the UI do not traverse their directories.

The storage-usage scanner streams directory entries and reads lstat/realpath metadata only; it never reads file contents, runs Git or executes project programs. Defaults are 50,000 entries, depth 32 and 3,000 ms; the inspector uses a fixed 5,000 ms scan budget with the same entry/depth bounds. The time budget bounds cooperative scan work, not an operating-system call that is already pending. The scanner yields between bounded entry batches, accepts cancellation, closes directory handles, and does not traverse symlinks, junctions, redirected ancestors, cross-device descendants or special files. Pre/post identity checks and a final metadata pass disclose changes rather than describing the window as an atomic snapshot. Permission failures, missing roots, unavailable providers, unknown identities and entry/time/depth limits remain explicit; unmeasured categories use null bytes rather than zero.

The primary total is logical regular-file bytes, deduplicated by canonical path and verified dev + ino identity across all categories. Each category deduplicates internally; directory totals count file paths including hard-link aliases. Overlaps and unknown identities are reported, so these subtotals are not additive and no number claims exclusive physical allocation or reclaimable space. Large-file records use relative paths and source: unknown; no AI provenance or cleanup eligibility is inferred.

StorageInspector owns one active scan at a time and its cancellation lifetime, independently of the service mutation queue. The client cancels on scope/tab/window changes and ignores stale responses; a scan cannot execute, confirm or resolve a mutation. The workspace-list refresh only updates choices; a scan button is required to obtain a new measurement. Known scan/workspace refusal codes have localized next-step guidance. Results live in client state, without a scan database, automated sweep or new cleanup authority. Existing receipts are not automatically garbage-collected.

## Current trash measurements

TrashStore.entrySnapshot derives the current remaining regular-file bytes and confirmation fingerprint in one checked observation. It validates the manifest, allowed member/file names and identities, ignores mutable lock files for the confirmation token, and checks measured entries again before returning. A journaled partial purge may have missing members/logs; unjournaled missing data is refused. Listing and restore/purge previews use the current snapshot rather than saved original member sizes. A remaining owned migration temporary counts toward the entry's current file bytes; recovery metadata and lock files do not, so this figure can differ from a whole-category storage scan.

The service still compares the confirmed fingerprint after acquiring the native lease before restoration or purge. A changed size or identity invalidates the old confirmation. Measuring storage grants no additional deletion authority and promises no physical bytes reclaimed.

## Confirmed idle release

Only a fresh manual move execution may ask the adapter to release a loaded archived group. The version-pinned adapter resolves the host-owned ordered AgentLoop lifecycle disposer through Cordis effect metadata and exact native identities, rather than detaching registry entries or closing an unknown writer itself. This is an internal capability for the admitted host generation, not a stable cross-version unload API. It admits only an unambiguous managed lifecycle with every affected member wholly idle, no pending inbox input, no active maintenance, and no runtime-owned child outside the confirmed dedicated group. Missing or ambiguous capabilities keep the fallback pending state; active work and external write ownership stay protected.

After awaited native teardown, the service re-inspects the archived state, membership and content fingerprint, then acquires the normal session leases before any file move. A changed fingerprint requires fresh consent. Opening a list/preview and replaying an old startup queue do not trigger this idle-release path.

For an existing pending row, the client uses the existing cancellation API to end the old request, then asks for a new preview. A late cancellation response cannot reopen a closed dialog, and an uncertain cancellation must be reconciled before a fresh operation. The new preview still requires confirmation. No new filesystem authority crosses the browser boundary.

## Platform-specific storage and leases

- macOS uses the running host's native flock on each `session.lock`; held handles preserve ownership across a same-volume rename.
- Windows uses the JSONL backend's named-kernel-semaphore convention through its existing host-owned native binding. Names are derived from resolved, case-normalized paths. A transition reserves both the original session path and its current staging/trash path, so relocating logs cannot bypass ownership; restoration also reserves the original destination before it exists. Plugin-store ownership uses the same platform-compatible lease boundary.
- Windows admits only local absolute drive paths with an admitted local drive type. UNC/network paths, device namespaces, reserved names, ambiguous aliases, and symlink/junction redirection are refused. Configured roots and session directories must match their canonical locations apart from case; short-name aliases or junction ancestors cannot create alternate lock identities. Canonical roots and members are checked again; sibling-prefix and path-case aliases do not grant access.
- Recovery JSON reads require a bounded regular file and verify file identity before parsing. POSIX owner/mode checks apply where meaningful; Windows does not interpret POSIX mode bits as an ACL guarantee and inherits the existing DSH home's access controls.
- Metadata files are flushed before atomic replacement. POSIX also syncs containing directories; Windows uses recoverable operation records because Node cannot provide the same directory-sync operation. Process-interruption recovery is tested separately from power-loss durability, which is not claimed.

## Compatibility policy

The initial version gate is exact, not a promise that all `0.2.x` releases are compatible. It checks the active profile's runtime installation anchor, rather than trusting the plugin's pinned peer package to identify its host. Mutation requires the supported host version and platform, the JSONL backend, safe canonical roots, and usable activity/lease/registration capabilities. Failure to establish those conditions produces an explicit unsupported or blocked result. A version mismatch emits a startup diagnostic with required/current versions and upgrade guidance while retaining a readable disabled management dialog. `engines.dsh` describes compatibility but is not an installation-time gate.

Cordis, app boot, home paths, native system bindings, and React come from the host. Their peer declarations are optional for the package manager to avoid misleading missing-peer warnings; runtime admission still checks capabilities. The plugin adds no install hook. DSH's native manager registers its bundle. CLI users verify `dsh.profile.bundles` afterward and add the package name only if absent; manager-enabled launchers can reconcile automatically, while installation-only invocation modes need the explicit step.

Every access to an internal DSH shape belongs in the adapter. A future host change should require one explicit adapter update and real compatibility evidence, not a widened version range alone.

## Distribution and diagnostics

The primary installation source is a versioned GitHub Release `.tgz` built from the package file allowlist, with a matching SHA-256 file. Users explicitly add a new release URL to upgrade the same package name; the plugin does not add an updater, postinstall registration hook, or automatic profile editor. The native manager is preferred. Installation-only CLI paths require manifest registration checks, and removal requires cleaning this bundle's exact stale entry if the host leaves it behind.

A successful startup reports the plugin version, supported/current host versions, and resolved trash directory only after recovery and authenticated API registration. Disabled or failed startup retains its diagnostic instead of a false loaded line. This signal belongs to the current process; old directories and configuration dumps are insufficient activation evidence.

The separate packaged doctor is an offline read-only diagnostic boundary. It inspects the selected profile/package metadata, host package version, and existing storage access without opening session logs, creating directories, editing bundles, or performing repair. An offline pass checks prerequisites; the live management API and current loaded log demonstrate actual activation.

## Scope decisions

- No automatic trash expiry, background cleanup timer, or agent deletion tool.
- No forced interruption of active or unmanaged sessions, and no write-lock stealing. Wholly idle, managed lifecycle release requires fresh manual confirmation.
- No attachment garbage collection, spill cleanup, old third-party cache cleanup, project deletion, OCR, full-text search, or cross-agent migration.
- No custom plugin updater; installation/update remains with DSH's plugin manager.
- Opening the management list or preview does not mutate native session storage.
- Storage inspection is manual and read-only; it does not classify AI output or delete host/workspace files.

For the transition-by-transition rules, see [operations and recovery](operations.md).
