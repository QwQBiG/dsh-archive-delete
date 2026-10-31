# Acceptance and verification

[简体中文](acceptance.zh-CN.md) · English

## Evidence policy

Mutation fixtures use temporary directories and known synthetic conversations. No plugin data operations were performed on the user's primary profile, project files, or existing plugins. A passed unit test, an author-declared version range, and an actual host/UI integration run are recorded as different evidence.

The scenario table defines the acceptance targets. The verification record below identifies what was exercised, with exact commands, host/runtime versions, counts, and material limits. Source review alone does not turn an unperformed check into a passed check.

## Required scenarios

| Area | Scenario | Required outcome |
| --- | --- | --- |
| Cold archived session | Preview, move, restore and purge in one process; repeat across restart boundaries | Log bytes and native bookkeeping agree with each visible state; purge does not require restart |
| Scope | Request an unarchived or unknown session | No source mutation; explicit rejection/skip |
| Ownership | Parent with explicit subagents and an independent fork | Subagents move with parent; fork remains intact and readable |
| Activity | Running turn, subagent, background job, schedule, or pending interaction | Group is not moved or queued as idle |
| Own-host lease | A wholly idle managed session opened earlier in this process | Fresh manual confirmation may release its native lifecycle and move now; unavailable safe release keeps logs pending |
| External lease | Another process holds `session.lock` | Refusal without stealing the lock |
| Pending cancellation | Cancel, restart | Target is not moved |
| Pending drift | Add content or unarchive after queuing | Old request does not move changed data |
| Pending retry | Cancel waiting and review; close/cancel/confirm the new preview, or reconcile an uncertain response | Old queue ends explicitly; a fresh confirmation is required, and a late response never reopens a closed dialog |
| Idle-release protection | Running or maintenance phase, pending input, unknown lifecycle, ambiguous disposer, or runtime-owned child outside the group | Refuse teardown/move, preserving work and independent relationships |
| Release drift | Native teardown fails or changes content/archive state before a move | Do not move changed or unverified data; report the reason and require fresh review |
| Startup replay | An old queued request encounters a loaded session | Do not invoke the fresh-manual idle-release path; retain protected pending behavior |
| Batch | Ready, pending, skipped, and failed targets together | Exact per-item statuses and consistent counts; retry only failed targets |
| Idempotency | Double click, duplicate request, response lost | One transition and a stable result |
| Confirmation | Cancel a move/purge confirmation | No mutation occurs |
| Paths | Traversal, session/project symlink, source-root mismatch | Refuse, leaving parents, neighbors, and project files intact |
| Windows storage | Local paths, case aliases, UNC/device paths, junctions, and native lease contention | Admit safe local identity; refuse redirected/remote paths and occupied original/relocated locations |
| Desktop CLI registration | Install the packed dependency, inspect bundles, register once, and load | Do not mistake package installation for activation; preserve existing bundles and avoid duplicate registration |
| Same-volume rule | Trash on a different volume | Refuse without copy-and-delete fallback |
| Content admission | Unexpected files or invalid manifests | Refuse mutation/purge, preserving data |
| Restore collision | Original destination now exists | Refuse overwrite; retain recoverable trash |
| Missing workspace | Original registration is gone | Restore archived Ungrouped; create no project directory |
| Shared files | Shared attachments, spill, project directory, other plugin cache | Stay untouched through move, restore, and purge |
| Crash recovery | Fail before/after every move and registration boundary | Recoverable recorded state, no false success, no duplicate transition |
| Partial purge | Remove some owned files, then fail | Report actual incomplete state, no promise of complete restore |
| Read-only list | Open list and impact preview | Do not activate sessions or rewrite native logs/bookkeeping |
| Host gate | Wrong DSH version, platform, backend, missing capability | UI explains unsupported state; mutation unavailable |
| Native UI | Menu, plugin details button, tabs, selection, confirmation, results | Visible in isolated DSH; no external management window |
| Accessibility/i18n | Keyboard interaction, zh/en, dark/light | Readable labels, explicit scope, usable controls |
| Package | GitHub install/update/remove in isolated profile | Included artifacts load; no dependency prepare build; trash retained on remove |
| Release package | Asset contains only declared files; download matching checksum | Exclude source/tests/CI; install without build and verify checksum |
| Upgrade and removal | Replace dependency with a new fixed URL, check bundle, clean stale selection after removal | No duplicate registration; preserve other profile fields, trash and recovery records |
| Doctor | Check registration, artifacts, host version and existing directory access | Read-only; do not create/repair directories or treat offline checks as a live-loaded signal |
| Loaded signal | Recovery/API registration succeeds, or startup refuses/fails | Emit plugin/host versions and trash location only on successful startup |
| Storage start/cancel | Open dialog/tab, choose a workspace, start/cancel, change tab or close during a scan | No automatic traversal; only an explicit start scans, cancelled/late results do not replace the current view |
| Storage source resolution | Configured roots outside DSH home, nested categories, missing providers and an in-memory search index | Resolve actual owners, exclude known child roots, measure only the configured index file; unknown/unavailable is not zero |
| Storage metrics | Hard links, repeated/overlapping roots and unknown file identities | Global logical-byte total counts verified duplicates once; category/folder aliases and incomplete identity checks are disclosed |
| Storage bounds | Entry/time/depth limits, unreadable entries, concurrent writes/removals | Bounded streaming metadata scan, explicit partial state and observation time; no file-content/Git/program reads |
| Storage path safety | Symlink/junction, ancestor redirection, cross-device descendant or special file | Do not follow the redirect or measure its outside target; preserve fixture bytes |
| Workspace scope | Registered ID, stale membership/path, drive root, user home/ancestor or protected host data | Scan one current admitted project only, reject unsafe roots and exclude known host-data descendants |
| Workspace provenance | Large project files or file names suggesting generated output | Show unknown origin; no AI classification, deletion action or cleanup authority |
| Current trash size | File changes after move or journaled partial purge, including a fully removed member | List/preview remaining bytes from the checked fingerprint observation, not historical manifest totals; drift invalidates old consent |
| Sorting | Default/largest-first changes across a page boundary | Stable visible ordering, reset to page one and clear old selection/preview; pending controls retain their protections |
| Read-only retention | Scan attachments, cache, spill, profiles, project files and receipts | No cleanup or automatic receipt expiry; all contents remain unchanged |
| GitHub discovery | Stable/newer releases, exact host/OS compatibility, release/candidate bounds, failed network/rate checks | Metadata-only checks; daily success cache, one-minute manual throttle and failure retry after at least one hour or a longer rate-limit window; never treat failure as current or install automatically |
| Update integrity | Changed IDs/SHA/metadata, untrusted redirects, oversized gzip/tar, traversal/links/duplicates, hooks/dependencies/peers | Reject before native installation; require a fresh matching server pin and verified package identity/prebuilt files |
| Update admission | Profile-owned same-package target, double confirmation, request replay, archive work already accepted | Only current profile through the native manager; drain/pause archive mutations, one installation, stable request identity |
| Update recovery | Cached/loaded version difference, response lost, unload/reload, activation failure | Independent per-profile check/install journals; reconcile installed state, retain verified file cache, protect uncertain/restart state; no full activation rollback guarantee |
| Update UI | Details/dialog cards, notes, review/confirm/cancel, stale responses | Show running/installed versions, render notes as text and never install from check/open alone |
| Documentation | Links, commands, and version references | Existing relative targets and consistent documented commands/versions |

Additional reliability regressions cover:

- Healthy-list availability with protected damaged/duplicate identities and unknown ancestry; missing manifests remain untouched.
- Preview consumption even if durable publication reports failure; same-request recovery and expiry/maintenance rejection.
- Consistent coalesced reads, retained idempotency receipts, explicit temporary-file cleanup and cold-versus-warm index behavior.
- Same-scope rescan retention, stale-response rejection and order-independent workspace exclusions.
- Streaming 64 KiB owner-route admission, late-install observation, GitHub backoff, shared verification budgets and exact release checksum agreement.

## Commands

```sh
pnpm verify
pnpm pack --pack-destination artifacts
node scripts/release-artifacts.mjs artifacts
node --import tsx scripts/check-update-package.mjs artifacts
node scripts/verify-package-lifecycle.mjs ./artifacts/qwqbig-dsh-archive-delete-0.0.2.tgz
```

`verify` covers build/type checks, unit tests, native integration, documentation checks, and package validation. Use Node 24 or newer; the recorded local run used the Desktop-bundled Node/pnpm through `PATH`. The package lifecycle command is a separate check after `pack`.

## 0.0.2 reliability verification

Local regressions exercise protected damaged-record diagnostics, missing-bucket recovery, ordered purge/staging flushes, directory replacement guards, single-use preview publication failures, same-ID replay, coalesced refreshes, receipt indexing, strict response/request validation and the authenticated streaming body limit. Client checks cover maintenance/expiry races, eligible/protected counts, localized timestamps and previous-result rescans. Update checks cover uncertain-request reconciliation, observation beyond thirty seconds, shared network budgets, cancellation before delegation, rate-limit backoff, package admission and checksum/metadata agreement. These checks use synthetic data; historical Desktop evidence below is not a new graphical run of this release.

On macOS with Node `24.21.0`, local `pnpm verify` passed 251 of 254 checks with 3 Windows-only skips, and 20 of 21 native host checks with 1 Windows-only skip. Type/build, documentation and package checks passed. Data mutations ran against isolated synthetic profiles.

An isolated macOS Desktop process loaded the new plugin, exposed a separate damaged-trash warning beside a healthy archive, and produced the new idle-release/count confirmation with update controls hidden. The installed app was reused through an APFS clone with isolated home/profile/userData; it already contained unrelated shell edits and is not a pristine vendor-shell test. Native owner authentication was retained. The desktop control tool then reported inconsistent AX/screenshot/window state, so a complete new graphical move/restore/purge/scan pass is not claimed. The native SDK suite independently verifies those data transitions. The QA process quit normally; project/shared-attachment/orphan sentinels stayed byte-identical, and the temporary app/profile was removed.

A local synthetic 5,000-receipt microbenchmark measured approximately 417 ms for the previous full-read listing, 24 ms for a new index's first recent lookup, and 0.8 ms median across five warm lookups. All 5,000 receipts remained present. This is a local repeated-read measurement, not a startup or cross-platform latency guarantee.

## Historical verification: 0.0.1

Release: `0.0.1`. Target: official DSH Desktop `0.2.1-rc.3`, default JSONL storage, Node `24.21.0` and pnpm `11.28.5`. Data mutations use isolated profiles and synthetic conversations; the primary Desktop profile is not a test fixture.

The retained runtime/client implementation at `e7c5d2ff41c815fef7066f21bbf110ed30eedee4` passed [CI run 40876833948](https://github.com/QwQBiG/dsh-archive-delete/actions/runs/40876833948): 202 of 205 checks passed on each platform, with 3 platform-specific skips. Native integration passed 20 of 20 on Windows and 19 of 20 on macOS, with 1 Windows-only skip. Both platforms passed type/build, committed-bundle comparison, package/docs checks, packing/checksums/update metadata, updater admission and isolated installation/URL replacement/reinstallation/removal.

The initial-release packaging uses that implementation with a new package version and consolidated documentation. Its package identity, updater metadata and installation lifecycle are verified separately; a version-only change does not imply a new graphical run.

For the `0.0.1` package, local full verification passed 202 of 205 checks with 3 Windows-only skips, and 19 of 20 native checks with 1 Windows-only skip. Build, docs, package identity, SHA-256/update metadata and updater admission passed. An isolated explicit replacement from a higher-numbered synthetic package to this package verified the installed version/source, one bundle registration, retained profile fields, unchanged trash/log bytes, responding owner API, Doctor and uninstall/reinstall. This is a manual replacement check, not a relaxation of forward-only automatic updates.

### Runtime coverage

- True JSONL/registry move, archived restore and permanent deletion preserve native bookkeeping and original log bytes where recovery applies. Parent/subagent groups move together; independent forks, shared attachments and project files remain intact.
- Genuine factory-created idle agents cover the host's omitted-live/default-zero delegation depth. Native lifecycle release, fresh fingerprints and normal write leases allow immediate move and purge; actual metadata changes, maintenance, queued input, active work, external writers and uncertain ownership remain protected.
- Persistent operation/request journals cover interrupted moves/restores/purges, intent/result failures, duplicate requests, partial purge, startup replay and pending cancellation/drift. Unknown files, traversal, symlinks, junctions, cross-volume layouts and conflicting restore paths refuse safely.
- Read-only storage scans use configured owners and explicit workspace IDs, deduplicate verified identities, remain bounded/cancellable, and disclose unavailable or partial results. They do not infer AI provenance or grant deletion authority over project files, shared attachments, spill or cache.
- Update checks cover compatible stable selection, daily/manual/error caches, fixed sources, bounded downloads, pinned metadata, SHA-256, strict tar/package admission, explicit confirmation, per-profile receipts, native-manager failure and installation/restart reconciliation. Malicious paths/links, hooks and unexpected runtime dependencies are refused.
- UI checks cover selection/page/tab/sort changes, review/cancel/confirm, late responses, localized results, compact version information, and absence of update controls during archive confirmation. Doctor and package lifecycle checks distinguish installed files, bundle registration and an actually responding owner API.

### Desktop evidence

An APFS clone of the installed macOS app used separate home/profile/userData and known synthetic data. QA-only bootstrap/title/first-use visibility hooks kept the native gateway authentication; no real credentials/history or model calls were used and no app was downloaded. The copied shell inherited local modifications, so it is not pristine-shell evidence.

The native management flow displayed compact version/status/check/details controls. A fresh factory-owned idle session preview showed the release attempt and no update controls. Confirmed move returned one success, no pending/failure and one trash entry. User-confirmed graphical permanent deletion returned an empty trash and one success. The host PID stayed the same across move and purge; project/shared-attachment markers remained byte-identical. Separate completed graphical checks covered restore and update review/cancel/confirmation/activation/full quit-and-reopen with retained synthetic-data hashes. These checks describe the retained implementation, rather than a fresh graphical run for each package metadata change.

### Limits

Windows Desktop GUI, physical cross-volume moves and whole-machine power loss were not visually/physically exercised. Native Windows integration, layout rejection and synthetic/process-level recovery checks are separate evidence. Graphical cancel-pending remains unverified. One successful HMR update does not guarantee every future upgrade activates without restart or fully rolls back arbitrary activation failures. Compatibility is limited to the stated host/storage/OS capabilities.
