# Architecture

[简体中文](architecture.zh-CN.md) · English

## Intent and boundaries

The mutation lifecycle remains: **archived → trash → archived again, or explicit permanent purge**. It targets official DSH Desktop `0.2.1-rc.3` with the JSONL persistence backend. Both macOS and Windows are supported, with native host and package lifecycle checks on each platform.

DSH remains the authority for live sessions, workspaces, activity, and session history. Original log bytes remain the authority for a conversation. The plugin owns its operation records, trash manifests, update records/packages, and native UI contributions. It also offers bounded, read-only inspection of host-configured storage and a manually selected registered workspace. Confirmed GitHub updates are installed by DSH's native manager in the current profile. It does not install a replacement workspace registry, session backend, projection cache, sidebar, or package manager.

## Four modules

| Boundary | Responsibilities | Must not do |
| --- | --- | --- |
| `client` | Native menu item, management dialog, selection, preview, confirmation, localized results | Accept filesystem paths, guess a move succeeded, or mutate storage directly |
| `service` | Validate requested actions, inspect complete groups, serialize transitions, revalidate before execution, report partial results | Know undocumented host field layouts or perform unjournaled filesystem mutation |
| `dsh-adapter` | Exact-version capability admission, host lists/activity, explicit subagent relationships, canonical locations, compatible write leases, native idle-release admission, registration cleanup/restoration, trusted storage-source resolution | Infer ownership merely from a supplied path or silently support unknown host generations |
| `storage` | Plugin-local manifests, durable operation stages, same-volume moves, recovery, confined purge, a separate metadata-only usage scanner | Recursively delete arbitrary paths, overwrite a conflicting source, or clean shared attachments |

Shared types live in the contracts module. The service depends on the adapter contract rather than importing the entire DSH runtime. Tests can therefore exercise the real storage transitions with synthetic adapters, while separate integration tests exercise the actual host boundary.

Updating has separate source, service, host-adapter and client contracts: `update-source` discovers and verifies fixed GitHub release assets, `update-service` owns check caching and installation intent, `update-host` admits the current native manager/profile, and the update client renders status and confirmation. These components do not join session recovery receipts or replace the host's installation machinery.

## UI and transport

An archived session's native row menu receives **Move to trash**. The plugin details page receives **Manage archives, trash and storage**, opening an Archived / Trash / Storage overview native dialog. This surface uses DSH components and module loading; React and DSH are provided by the host.

The browser sends requests to `/api/dsh-archive-delete` through DSH's authenticated connection gateway. The request vocabulary is deliberately small:

- `list`: support, archive/trash records, protected-record diagnostics, recent operation results, and registered workspace IDs/titles.
- `preview`: action (`trash`, `restore`, or `purge`) and selected IDs.
- `execute`: an opaque preview ID and request ID.
- `cancelPending`: selected session IDs and request ID.
- `storage`: no workspace ID for configured DSH storage, or one currently registered workspace ID. No client-selected path or scan limit is accepted.
- `updates`: a `force` boolean requests cached status or a rate-limited manual check.
- `installUpdate`: a server-issued candidate ID and request ID, following explicit update review and confirmation.

The browser never supplies source or destination paths. Preview data describes the target, group members, size, and ready/pending/blocked disposition. The service rechecks authoritative state when executing; a preview does not grant permission to act on changed data.

Results distinguish `moved`, `pending`, `restored`, `purged`, `cancelled`, `skipped`, and `failed`. Batch counts are derived from per-item results. A pending request is not a successfully moved conversation.

The update card shows running/installed versions, the last check and release status. Release notes are bounded plain text, escaped by the renderer; they are not rendered as executable HTML. The browser never supplies an update URL, checksum, archive bytes, package path, package name, profile path, or command. It submits only the candidate/request identifiers. An uncertain response retains the same request ID for status reconciliation or retry rather than authorizing a second upgrade.

The owner-only authenticated route reads the body as a stream and enforces 64 KiB before accumulating more input. Requests and responses validate enum and optional-text fields at the boundary. Confirmation derives ready/idle-release/protected counts, updates expiry state, and uses a distinct permanent-delete action. Maintenance invalidates pending preview generations; late replies cannot reopen a stale confirmation. Timestamps use the active host translation locale.

Archive listing builds a parent/child index once per inventory. Invalid or duplicate identities generate separate diagnostics instead of hiding healthy rows. The entire known relationship component stays protected; unidentified ancestry prevents archive mutation. Trash listing similarly isolates unreadable entries without deleting data or inventing recovery metadata, and reuses one operation inventory. Idle-release capability diagnostics are deduplicated by reason and exclude session content. Failed native peer-resolution promises are reset for a later attempt.

## Persistence and host consistency

Plugin state is under `<DSH_HOME>/archive-delete/`: transition journals in `operations/`, in-progress moves in `staging/`, physical trash in `trash/`, and request progress/receipts in `receipts/`. The actual home comes from the running host. The trash must remain outside the session root and on the same volume. Acquire the plugin-store lease before creating its data areas; a losing process does not initialize those areas.

A session group contains one selected parent and only its explicitly owned subagent descendants. A mere `parentSession` reference does not establish subagent ownership: independent forks also have parent relationships. Unknown or conflicting relationships block the group before any move.

Moving files and updating DSH bookkeeping are multiple operations, not one cross-system transaction. A durable request intent precedes mutation and receives per-target results. Its linked operation record captures progress and original registration data to reconcile a failed or interrupted transition. Completion proof remains until the request outcome is durable, closing the gap between committing files and replying to the browser. Group members are validated and locked before they move. Known host bookkeeping is updated through the adapter's serialized host write path, not by editing `workspace.json` directly.

The plugin does not keep a second full-text or projection mirror. Recovery metadata is retained while recovery is possible and removed with a purged trash entry. It does not store an extra copy of the conversation's first message for sidebar titles. Separate idempotency receipts retain request/target identifiers and operation outcomes, with conversation titles removed; these are not conversation backups.

Recovery JSON has the same 8 MiB read/write ceiling. Initial request intent is limited to 6 MiB, reserving room for up to 100 bounded per-target outcomes before any transition starts. Oversized metadata is rejected before a write/move and asks for a smaller batch; an admitted intent must remain writable as results accumulate.

A preview is consumed before publishing its first durable request intent, so an uncertain publication failure cannot reuse it under another ID. Same-request recovery still loads its intent/result. Overlapping refreshes share one listing promise while listing and mutations remain serialized for consistent observations. Completed receipts are retained for exact idempotency; a warm recent-result index validates up to ten displayed completed receipts instead of parsing all history on each refresh. Initial directory inventory and startup recovery remain proportional to history. Temporary receipt cleanup is an explicit startup step, not part of read-only receipt listing.

A new staging entry is synced in its parent before logs are moved into it. POSIX purge syncs member-file removals, member-directory removals and the manifest removal before removing the entry, syncing the trash parent, and completing the durable operation. Known missing original empty buckets are admitted only for recorded recovery/cleanup; existing unsafe paths still fail closed. Directory identity guards immediately precede path-based deletion, but Node has no portable `unlinkat`: a same-user adversary changing a parent during the final syscall remains outside this guarantee.

## Read-only storage inspection

The adapter resolves storage sources from the running exact-version host: JSONL persistence, attachment and attachment-cache roots, spill root, JSON settings backend root, configured search-index file, and DSH-home paths for plugin state, cache, profiles and other host data. It does not assume every source lives below DSH home or initialize a missing provider. The SQLite source measures only the configured regular file, never its parent directory. Valid registered project paths are also excluded from a DSH scan, including projects below DSH home; inspecting those files requires a separate explicit workspace scan. Resolving these exclusions only enumerates registry metadata. Known descendant roots are excluded from their parents; overlapping roots and verified duplicate identities remain disclosed and globally deduplicated.

Workspace enumeration reads only the registry. A scan re-resolves a single registered ID, rejects drive roots, the user home or its ancestors, unsafe redirects and internal protected host storage, and excludes known host-data descendants of an admitted project. Membership/path are re-read after scanning; stale registration cannot silently change the target. Server-owned paths stay behind the authenticated API. Listing workspaces and opening the UI do not traverse their directories.

The storage-usage scanner streams directory entries and reads lstat/realpath metadata only; it never reads file contents, runs Git or executes project programs. Defaults are 50,000 entries, depth 32 and 3,000 ms; the inspector uses a fixed 5,000 ms scan budget with the same entry/depth bounds. The time budget bounds cooperative scan work, not an operating-system call that is already pending. The scanner yields between bounded entry batches, accepts cancellation, closes directory handles, and does not traverse symlinks, junctions, redirected ancestors, cross-device descendants or special files. Pre/post identity checks and a final metadata pass disclose changes rather than describing the window as an atomic snapshot. Permission failures, missing roots, unavailable providers, unknown identities and entry/time/depth limits remain explicit; unmeasured categories use null bytes rather than zero.

The primary total is logical regular-file bytes, deduplicated by canonical path and verified dev + ino identity across all categories. Each category deduplicates internally; directory totals count file paths including hard-link aliases. Overlaps and unknown identities are reported, so these subtotals are not additive and no number claims exclusive physical allocation or reclaimable space. Large-file records use relative paths and source: unknown; no AI provenance or cleanup eligibility is inferred.

StorageInspector owns one active scan at a time and its cancellation lifetime, independently of the service mutation queue. The client cancels on scope/tab/window changes and ignores stale responses; a scan cannot execute, confirm or resolve a mutation. The workspace-list refresh only updates choices; a scan button is required to obtain a new measurement. Known scan/workspace refusal codes have localized next-step guidance. Same-scope rescans retain the prior timestamped result with an earlier-observation label, including on cancellation/failure; a scope change clears it. Equivalent exclusion sets are compared without depending on enumeration order. Results live in client state, without a scan database, automated sweep or new cleanup authority. Existing receipts are not automatically garbage-collected.

## Current trash measurements

TrashStore.entrySnapshot derives the current remaining regular-file bytes and confirmation fingerprint in one checked observation. It validates the manifest, allowed member/file names and identities, ignores mutable lock files for the confirmation token, and checks measured entries again before returning. A journaled partial purge may have missing members/logs; unjournaled missing data is refused. Listing and restore/purge previews use the current snapshot rather than saved original member sizes. A remaining owned migration temporary counts toward the entry's current file bytes; recovery metadata and lock files do not, so this figure can differ from a whole-category storage scan.

The service still compares the confirmed fingerprint after acquiring the native lease before restoration or purge. A changed size or identity invalidates the old confirmation. Measuring storage grants no additional deletion authority and promises no physical bytes reclaimed.

## Confirmed idle release

Only a fresh manual move execution may ask the adapter to release a loaded archived group. The version-pinned adapter resolves the host-owned ordered AgentLoop lifecycle disposer through Cordis effect metadata and exact native identities, rather than detaching registry entries or closing an unknown writer itself. This is an internal capability for the admitted host generation, not a stable cross-version unload API. It admits only an unambiguous managed lifecycle with every affected member wholly idle, no pending inbox input, no active maintenance, and no runtime-owned child outside the confirmed dedicated group. Missing or ambiguous capabilities keep the fallback pending state; active work and external write ownership stay protected.

Live-versus-persisted header comparison follows the pinned JSONL format: an omitted live `delegationDepth` equals its persisted default `0`, and object-key order is immaterial. All other fields, explicit invalid values and session object identity remain strict. This comparison does not relax the source-file fingerprint before or after teardown.

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

## GitHub discovery and package verification

The update source is fixed to `QwQBiG/dsh-archive-delete` GitHub Releases with stable `vX.Y.Z` tags. It considers at most 20 releases and checks metadata for at most five newer stable semantic versions, in descending version order. Drafts, prereleases and downgrades are excluded. Each candidate needs the release's matching `.update.json` asset, exact `requiredDshVersion` equality and support for the current macOS/Windows platform. Automatic discovery downloads metadata only, never the `.tgz`.

Production HTTP limits are 1 MiB for the release response, 32 KiB for update metadata, a shared 15-second budget per source operation (including discovery list/metadata requests) and at most three redirects. Installation preflight shares an additional 30-second total budget across its source stages. GitHub `Retry-After` seconds/HTTP dates and rate-limit reset times set a bounded backoff, which manual checks do not bypass. Network access follows the launched runtime environment; the plugin does not set a global proxy/agent or automatically enable `HTTPS_PROXY`. Initial API and download URLs belong to the fixed repository/tag/assets. API redirects are refused; asset redirects may use only the admitted HTTPS GitHub download/CDN hosts, without URL credentials. Network, timeout, rate-limit, malformed metadata and redirect failures remain explicit errors, not an up-to-date result.

A server-owned pin binds the release and asset identities, metadata identity, version, byte count, host/platform declaration and SHA-256. The browser receives only the public candidate. Confirmation performs a new check and fresh metadata revalidation before download; changed pins cannot inherit old consent. The downloaded bytes must match the declared length and SHA-256. SHA-256 checks consistency with the selected release; its trust anchor remains TLS and the GitHub repository, not a separate publisher signature or a code audit.

Verification decompresses and parses the archive in memory without extraction or execution: at most 16 MiB compressed, 64 MiB expanded and 4,096 tar entries. It rejects unsafe paths, links, duplicate/case-conflicting entries, special entries and malformed headers/checksums. The packed manifest is bounded to 64 KiB and must match the package name, confirmed version, exact DSH requirement, bundle patch and prebuilt host/browser artifacts. Installation/prepare hooks, runtime dependencies, optional dependencies and bundled dependencies are refused. Peer dependencies are limited to the five known optional host-provided packages, preserving the host's Cordis/React instances.

## Update admission, persistence and activation

The updater starts only after archive initialization and authenticated route admission on supported DSH Desktop `0.2.1-rc.3`, and only when its native manager identifies one unambiguous profile-owned installation of this package. It does not update a built-in, shared or other-profile package. If that capability is absent, admitted archive functionality remains available and the updater is not started. An unsupported future host still meets the original disabled UI/version gate; the updater cannot be promised as a way to self-upgrade past that gate.

The server hashes its canonical profile directory (`UpdateHost.profileId`) with SHA-256 to isolate update state per profile. `updates/<profile-hash>.check.json` caches discovery separately from session state. Successful/current/incompatible observations remain valid for 24 hours; automatic failures retry after at least one hour and respect a longer GitHub rate-limit window. Manual checks can bypass the normal cache after a minimum interval of 60 seconds, except during the retained rate-limit window. Hourly server wakeups and client status polling share this cache, so they do not each trigger a GitHub request. Failed discovery may retain the previous candidate for context but marks the observation as an error; installation still requires a newly verified available pin.

Only explicit confirmation downloads a package. Verified bytes are atomically retained in the private `<DSH_HOME>/archive-delete/updates/packages/<version>-<sha256>.tgz` location and validated again immediately before native installation. The manager installs this exact local archive as the current profile's same-named bundle and retains its `file:` source in profile metadata/lockfiles. Package files must remain available for reproducible reinstalls; there is no automatic cleanup of referenced archives. Distribution remains on GitHub, without an npm release or a custom package runner.

After verification, the archive service drains already admitted operations and closes its mutation gate before calling the manager. The installation is not placed inside the archive queue: the native manager may wait for this plugin to unload during hot replacement. `updates/<profile-hash>.installation.json` durably records the independent request, candidate, target version and outcome for that profile; retained package bytes can be shared without sharing its install outcome. Concurrent confirmations cannot start two manager operations, and repeated requests with the same ID re-read native installation state for that operation without replaying a recorded manager call. A matching installed target can settle to installed/restart-required; an old or unreadable target alone does not establish that the delegated operation ended. Client observation backs off from 3 to 15 to 60 seconds until settled or disposed. New upgrades remain blocked while an installation is in progress, uncertain or waiting for a restart.

Plugin disposal aborts and waits for discovery checks and cancels pre-install verification, but does not cancel or await an installation already delegated to the native manager; doing so could deadlock self-replacement. Running and installed versions are reported separately. Startup reconciles the installation record with the actual installed package and loaded code. A changed installed version, pending restart or uncertain outcome keeps archive mutations protected; users may need to fully quit and reopen DSH. The updater does not promise activation without a restart.

Native integration verifies same-profile replacement with retained packages and manifest/lockfile restoration after a rejected package. Arbitrary activation or hot-reload failures can occur after installation state changes; complete automatic rollback is not guaranteed. Uncertain outcomes stay visible for status checks or the same request, with diagnostics and restart guidance rather than a second implicit install. Conversations, trash and session-recovery records are outside the update operation.

Release generation invokes the same bounded package admission used at runtime before writing checksum/update assets. The release checker asserts that the public `.sha256` file, `.update.json` digest/byte count and actual package bytes agree, then exercises discovery, pin revalidation and download admission against local fixtures.

## Distribution and diagnostics

The primary installation source is a versioned GitHub Release `.tgz` built from the package file allowlist, with matching `.tgz.sha256` and `.update.json` assets. The update card can discover a compatible release and request a confirmed upgrade through the native manager; explicitly adding the new release URL remains the manual upgrade path. The plugin adds no postinstall registration hook or direct profile editor. Installation-only CLI paths require manifest registration checks, and removal requires cleaning this bundle's exact stale entry if the host leaves it behind.

A successful startup reports the plugin version, supported/current host versions, and resolved trash directory only after recovery and authenticated API registration. Disabled or failed startup retains its diagnostic instead of a false loaded line. This signal belongs to the current process; old directories and configuration dumps are insufficient activation evidence.

The separate packaged doctor is an offline read-only diagnostic boundary. It inspects the selected profile/package metadata, host package version, and existing storage access without opening session logs, creating directories, editing bundles, or performing repair. An offline pass checks prerequisites; the live management API and current loaded log demonstrate actual activation.

## Scope decisions

- No automatic trash expiry, background cleanup timer, or agent deletion tool.
- No forced interruption of active or unmanaged sessions, and no write-lock stealing. Wholly idle, managed lifecycle release requires fresh manual confirmation.
- No attachment garbage collection, spill cleanup, old third-party cache cleanup, project deletion, OCR, full-text search, or cross-agent migration.
- No silent update installation, arbitrary update sources, npm publication, package-runner replacement, or promise of activation without a restart. Installation remains with the current profile's native DSH plugin manager.
- Opening the management list or preview does not mutate native session storage.
- Storage inspection is manual and read-only; it does not classify AI output or delete host/workspace files.

For the transition-by-transition rules, see [operations and recovery](operations.md).
