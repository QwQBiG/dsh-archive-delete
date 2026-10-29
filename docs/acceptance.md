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
| GitHub discovery | Stable/newer releases, exact host/OS compatibility, release/candidate bounds, failed network/rate checks | Metadata-only checks; daily success cache, one-minute manual throttle and one-hour failure retry; never treat failure as current or install automatically |
| Update integrity | Changed IDs/SHA/metadata, untrusted redirects, oversized gzip/tar, traversal/links/duplicates, hooks/dependencies/peers | Reject before native installation; require a fresh matching server pin and verified package identity/prebuilt files |
| Update admission | Profile-owned same-package target, double confirmation, request replay, archive work already accepted | Only current profile through the native manager; drain/pause archive mutations, one installation, stable request identity |
| Update recovery | Cached/loaded version difference, response lost, unload/reload, activation failure | Independent per-profile check/install journals; reconcile installed state, retain verified file cache, protect uncertain/restart state; no full activation rollback guarantee |
| Update UI | Details/dialog cards, notes, review/confirm/cancel, stale responses | Show running/installed versions, render notes as text and never install from check/open alone |
| Documentation | Links, commands, and version references | Existing relative targets and consistent documented commands/versions |

## Commands

```sh
pnpm verify
pnpm pack --pack-destination artifacts
node scripts/release-artifacts.mjs artifacts
node --import tsx scripts/check-update-package.mjs artifacts
node scripts/verify-package-lifecycle.mjs ./artifacts/qwqbig-dsh-archive-delete-0.1.5.tgz
```

`verify` covers build/type checks, unit tests, native integration, documentation checks, and package validation. Use Node 24 or newer; the recorded local run used the Desktop-bundled Node/pnpm through `PATH`. The package lifecycle command is a separate check after `pack`.

## Verification status — 0.1.5

Status: unreleased. Automated verification passed on both platforms; the Desktop graphical confirmation/install and restart outcome remain incomplete.

### Completed CI and local verification

Date: 2026-10-29. Both jobs in run `40853917318` passed on runtime/client commit `2c3e281aaa3cc55e8be59bbfdd23bace0e78bbd9`, using official DSH `0.2.1-rc.3`, Node `24.21.0`, pnpm `11.28.5`, isolated runtimes and synthetic profiles.

| Platform | Completed CI evidence | Unit/client/service/scanner/updater | Native integration |
| --- | --- | --- | --- |
| macOS (macos-14) | [Run 40853917318, job 123379996983](https://github.com/QwQBiG/dsh-archive-delete/actions/runs/40853917318/job/123379996983) | 193 passed, 3 Windows-only skipped; 196 total | 17 passed, 1 Windows-only skipped; 18 total |
| Windows (windows-latest) | [Run 40853917318, job 123379996635](https://github.com/QwQBiG/dsh-archive-delete/actions/runs/40853917318/job/123379996635) | 193 passed, 3 POSIX-only skipped; 196 total | 18 passed, 0 skipped; 18 total |

- Both jobs passed type/build checks, the committed `lib` comparison, documentation checks (7 pairs, 62 relative links), package validation, packing, SHA-256 and update-metadata generation, strict updater admission, and the isolated package lifecycle: installation, loopback-URL upgrade, reinstall and uninstall.
- GitHub-source tests cover stable/compatible selection, bounded metadata-only discovery, fixed URLs/CDN redirects, changed confirmations, SHA-256, malicious tar/manifest content, dependency/hook refusal, size limits, cancellation, timeouts, rate limiting and offline errors. Source tests use synthetic HTTP responses. `check-update-package.mjs` also exercises discovery, pin revalidation, checksum and package admission against the actual generated assets through local response fixtures.
- Update service/client checks cover daily/manual/error cache timing, per-profile journal isolation, confirmation and request identity, maintenance-gate draining, loaded-versus-installed versions, uncertain outcomes and disposal during replacement. A failed check does not become an up-to-date result, and opening/checking does not install a package.
- Real native SDK manager integration replaced a persistent verified package only in its isolated profile and reported `restart-required` without HMR. A rejected bundle restored that profile's manifest and lockfile. These tests do not prove complete rollback after arbitrary new-code activation or successful graphical self-replacement.
- Local macOS full verification passed 192 checks with 3 Windows-only skips out of 195 before the final UI error-message regression was added. A subsequent targeted UI run passed all 26 checks, including that regression; the final CI totals above include all 196. Local packing, metadata/updater admission and the isolated package lifecycle also passed, reusing the installed DSH runtime without downloading another app.
- A separate read-only check against the public fixed GitHub release endpoint returned `current`. It downloaded no app or package and is not public-network installation timing evidence.

### macOS Desktop graphical evidence and remaining checks

The installed app was reused through an APFS clone, with separate home/profile/userData and synthetic conversations/project files. Shell changes were limited to QA isolation/hooks; the live host used its native UI and HMR. No real profile/history was used and no second app was downloaded.

The native **Plugin updates** card visibly showed **Running 0.1.5**, a synthetic available `0.1.6`, its Release link, and **Review update**. Expanding review displayed English/Chinese synthetic notes as plain text, the installation scope, and **Cancel / Confirm upgrade** controls. Clicking **Cancel** left the installed version at `0.1.5`; no installation journal or `.tgz` download appeared. Synthetic session/project hash baselines were recorded for subsequent retention checks.

The Mac then locked during the continuing GUI run. Computer use requires the user to unlock it manually; the unlock request is pending. The final **Confirm upgrade** click, actual graphical installation, installed/running-version or restart display, and post-install hash comparison have not completed and are not recorded as passed. Automated native-manager success/rollback above is separate evidence. Windows Desktop GUI has not been visually tested. Earlier completed release records remain below.

## Historical CI verification — 0.1.4

Date: 2026-10-29. Both jobs in run 40845896781 passed on runtime commit f8a409a1967f2f252438128390e4307cca4f70ad, using official DSH 0.2.1-rc.3, Node 24.21.0, pnpm 11.28.5, isolated runtimes and synthetic profiles.

| Platform | Completed CI evidence | Unit/client/service/scanner | Native integration |
| --- | --- | --- | --- |
| macOS (macos-14) | [Run 40845896781, job 123353173851](https://github.com/QwQBiG/dsh-archive-delete/actions/runs/40845896781/job/123353173851) | 152 passed, 3 Windows-only skipped; 155 total | 15 passed, 1 Windows-only skipped; 16 total |
| Windows (windows-latest) | [Run 40845896781, job 123353173398](https://github.com/QwQBiG/dsh-archive-delete/actions/runs/40845896781/job/123353173398) | 152 passed, 3 POSIX-only skipped; 155 total | 16 passed, 0 skipped; 16 total |

- Both jobs passed type/build checks, the committed lib comparison, documentation checks (7 pairs, 60 relative links), package validation, packing, SHA-256 verification and the isolated native package lifecycle: installation, local loopback-URL upgrade, reinstall and uninstall. The three Windows unit skips were Doctor's POSIX permission check, the scanner's POSIX unreadable-directory check and its POSIX canonical-alias exclusion check.
- A new native integration check used actual LocalAttachmentStore, LocalSpillStore, the JSON backend, WorkspaceRegistry and SqliteSessionQueryEngine configured never to open its database. It loaded the plugin through applyPlugin and requested scans through the authenticated owner gateway; the in-memory search category remained unavailable and no query database was opened.
- That native check counted three attachment hard-link paths once, separated attachment cache from other cache, excluded registered project directories from the DSH scan, and measured only the explicitly selected workspace: 35 bytes across two files. All reported file origins stayed unknown. Cancellation was followed by a successful rescan; a supplied path field returned 400 and a tool principal returned 403. Registry state, original session/attachment/spill bytes and unselected project data remained intact.
- Scanner/provider regressions covered configured locations, exclusions, path/hard-link overlap, unknown and missing roots, entry/time/depth limits, cancellation, metadata changes and unsafe path refusal. Client checks covered explicit scan start, stale-response protection, localized refusal guidance, workspace-list refresh and sort-selection behavior. These are programmatic and rendered-markup checks, not a new Desktop graphical run.
- Current-trash size and consent checks covered remaining log/temporary bytes, partial purges, missing-member journal admission, same-observation drift and restore/purge preview fingerprints. Native lifecycle and held-lease confirmation regressions continued to pass; no measured logical-byte value was treated as reclaimed physical space or broader deletion authority.
- Local macOS verification also passed: 152 unit/client/service/scanner checks with 3 Windows-only skips, and 15 native checks with 1 Windows-only skip, plus packing and the isolated package lifecycle. It reused the installed official runtime without downloading another copy.
- No new Desktop graphical evidence, public-network download timing or real-history data operation is claimed. Earlier completed release records remain below.

## Historical CI verification — 0.1.3

Date: 2026-10-29. Both jobs in run `40841619020` passed on runtime commit `b5c15ce87ae3b1b4a7c050646113d4dc56336378`, using official DSH `0.2.1-rc.3` JSONL persistence, Node `24.21.0`, pnpm `11.28.5`, isolated runtimes and synthetic profiles.

| Platform | Completed CI evidence | Unit/client/service | Native integration |
| --- | --- | --- | --- |
| macOS | [Run 40841619020, job 123339102623](https://github.com/QwQBiG/dsh-archive-delete/actions/runs/40841619020/job/123339102623) | 109 passed, 3 Windows-only skipped; 112 total | 14 passed, 1 Windows-only skipped; 15 total |
| Windows | [Run 40841619020, job 123339103108](https://github.com/QwQBiG/dsh-archive-delete/actions/runs/40841619020/job/123339103108) | 111 passed, 1 POSIX-only write-permission check skipped; 112 total | 15 passed, 0 skipped; 15 total |

- Both platform jobs passed build/type checks, documentation and package checks, the committed `lib` comparison, packaging, SHA-256 verification and the extended native package lifecycle.
- Restore and permanent purge recheck the confirmed trash fingerprint after obtaining the native lease, before mutation. Two added regressions change trash log bytes while the lease is being acquired; both reject the old confirmation and preserve the contents.
- The three native managed-release tests passed on both platforms. A factory-managed parent and dedicated child released their actual lifecycle and writer ownership, moved to trash and were permanently purged through the same service/process. An independent fork's log bytes remained intact.
- Admission checks refused maintenance, pending inbox input, a runtime-owned child outside the confirmed group, and an ambiguous lifecycle effect. Missing safe-release capability retains the pending fallback. The service rechecks content, archive state, members and write leases after teardown before moving.
- Client regressions cover ending an old pending request, opening a fresh preview without executing it, close/cancel races, and uncertain cancellation handling. Existing trash was also moved and purged within one open client/service; a busy purge retained its logs and did not become a pending deletion.
- Startup replay remains separate from fresh manual idle release. The completed checks do not add Desktop graphical verification, public-network performance claims or tests on real user history.
- Local macOS checks also exercised the no-restart native lifecycle, packing and the extended package lifecycle. The final CI counts above include the two later lock-time consent-race regressions. Earlier completed release records remain below.

## Historical CI verification — 0.1.2

Date: 2026-10-29. Both jobs in run `40835348347` passed on the same runtime commit, `d2bb1257f2706742d851ca4712cfcd707ea187b5`, using official DSH `0.2.1-rc.3` JSONL persistence, Node `24.21.0`, pnpm `11.28.5`, isolated runtimes, and temporary synthetic profiles.

| Platform | Completed CI evidence | Unit/client/service | Native integration |
| --- | --- | --- | --- |
| macOS | [Run 40835348347, job 123318710293](https://github.com/QwQBiG/dsh-archive-delete/actions/runs/40835348347/job/123318710293) | 89 passed, 3 Windows-only skipped; 92 total | 11 passed, 1 Windows-only skipped; 12 total |
| Windows | [Run 40835348347, job 123318709939](https://github.com/QwQBiG/dsh-archive-delete/actions/runs/40835348347/job/123318709939) | 91 passed, 1 POSIX-only write-permission check skipped; 92 total | 12 passed, 0 skipped; 12 total |

- Both platform jobs passed build/type checks, documentation and package checks, the committed `lib` comparison, packaging and SHA-256 verification, and the extended native package lifecycle.
- Packed Doctor CLI checks passed for a structured JSON report and invalid-usage exit code 2. Reports retained `runtimeState: unverified`; offline prerequisites were not represented as live activation.
- All three installation paths loaded the authenticated API. Fixed-URL upgrade checks used two distinct local HTTP asset URLs, replaced the dependency with `add` without first removing it, and preserved custom manifest fields, bundle entries, and the byte content of synthetic session logs already in trash. The upgraded installation also loaded its API.
- Raw pnpm removal reproduced a stale bundle entry, followed by idempotent cleanup preserving other fields and trash. The tested Desktop CLI removed its entry automatically; manager reinstall/removal checks also preserved trash. These results document the tested invocation modes rather than assuming every host build behaves identically.
- This is native runtime and package verification. It does not add a graphical Desktop run, a public GitHub download benchmark, or a network/proxy performance claim. The HTTP asset server is a local fixture.

## Historical local verification — 0.1.2

Date: 2026-10-29. The local macOS run used the existing DSH `0.2.1-rc.3` JSONL runtime, Node `24.21.0`, pnpm `11.28.5`, and temporary synthetic profiles. The corresponding completed CI matrix is recorded above; the previous release's matrix remains a separate historical record below.

| Check | Completed local result |
| --- | --- |
| Unit/client/service | 89 passed; 3 Windows-only cases skipped |
| Native integration | 11 passed; 1 Windows-only case skipped |
| Packed Doctor CLI | Structured JSON report passed; an invalid invocation returned usage exit code 2 |
| Installation lifecycle | Three installation paths loaded the authenticated native API; manager reinstall/removal retained trash |
| Fixed-URL upgrade | Two distinct local HTTP asset URLs replaced the dependency in place with `add`, without first removing it |
| Registration and uninstall | Raw pnpm removal left the selected bundle; explicit cleanup was idempotent. This local Desktop CLI cleaned its entry automatically |

- The expanded lifecycle fixture uses a local HTTP server to model versioned Release asset URLs. It verifies the dependency source/version changes while custom manifest fields, existing bundles, and the byte content of synthetic session logs already moved into trash remain intact. It does not claim a public GitHub download or network/proxy benchmark.
- The actual Desktop CLI launcher, direct dependency-only installation followed by manual registration, and the native manager remain separate checks. Their packed plugin copies reached the authenticated API. Reinstall and removal checks preserved synthetic trash, and manual bundle edits preserved unrelated profile fields.
- Doctor checks run against the packed executable and synthetic profile. JSON output retains `runtimeState: unverified`; the report does not claim live activation. The usage-error check is distinct from a failed/incomplete diagnostic report.
- The new local results do not rerun the historical macOS graphical interaction checks or visually exercise Windows Desktop. No real user sessions or primary profile were used.

## Historical CI verification — 0.1.1

Date: 2026-10-28. Target: official DSH `0.2.1-rc.3`, JSONL backend, Node `24.21.0`, and pnpm `11.28.5`. CI uses a fresh isolated official runtime and temporary synthetic profiles. Both platform jobs below passed on the same verified commit, `7e434b4`, in the same matrix run. The `0.1.1` release retained that runtime unchanged; only package-version and documentation metadata were updated afterward.

| Platform | Completed CI evidence | Unit/client/service | Native integration |
| --- | --- | --- | --- |
| macOS | [Run 40697905681, job 122849499014](https://github.com/QwQBiG/dsh-archive-delete/actions/runs/40697905681/job/122849499014) | 78 passed, 3 Windows-only skipped | 10 passed, 1 Windows-only skipped |
| Windows | [Run 40697905681, job 122849499350](https://github.com/QwQBiG/dsh-archive-delete/actions/runs/40697905681/job/122849499350) | 81 passed, 0 skipped | 11 passed, 0 skipped |

- Both completed jobs passed build/type checks, documentation and package checks, a clean diff of committed `lib` artifacts, `pnpm pack`, and the native package lifecycle check.
- Native integration uses real Cordis, JSONL persistence, storage domains, workspace registration, projection cache, Connection gateway, and platform-compatible native leases. It verifies move/restore/purge, durable official titles after cache-domain reopen, readable independent forks after parent/subagent trash, owner admission, external/native leases, pending cancellation/replay, Agent waiting-state admission, default zstd byte preservation, live runtime-version admission, partial-purge retry, and interrupted-move rollback. Agent waiting status uses a controlled boundary fixture.
- Windows exercised actual host-compatible kernel semaphores, foreign-process ownership, release after the owner process exits, and contention at both original and relocated session paths. Native Windows filesystem checks exercised junction/file-symlink refusal, canonical storage identity, and case aliases. Lexical checks reject UNC/device paths, reserved names, and ambiguous aliases; drive-type admission rejects remote and unknown media.
- Request-journal tests cover persisted intent, per-target results, duplicate/conflicting requests, restart, completion redaction, crash-left temporaries, cancellation, early oversized-intent refusal, and reserved capacity for all 100 worst-escaped outcomes. Recovery regressions include result-write failure after committed move/restore/purge, missing-manifest cleanup, empty staging, partial purge, changed trash previews, invalid commit proof, post-crash writers, original pending-receipt updates, mismatched identities/paths, and oversized-queue refusal without source changes.
- On each platform, package verification exercised **three installation paths**: the actual Desktop CLI launcher with a bundle check; direct pnpm installation without activation followed by explicit registration; and the native plugin manager with automatic registration. Each installed copy loaded through normal module resolution and a real authenticated API returned `supported: true`. No peer overrides or resolution hooks supplied the plugin's dependencies. The tested Desktop CLI registered automatically; the direct pnpm path did not, and applying the documented repair twice preserved other settings without duplicate bundles.
- The additional manager reinstall/remove steps exited successfully in `normal-offline-cache` mode. A synthetic trash marker stayed byte-identical, and removal cleared the dependency and bundle registration. Installations used precompiled artifacts with dependency scripts disabled; no missing-peer warnings were reported.
- Unsupported-version tests verify startup diagnostics, the visible required/current versions and upgrade instruction, and refusal of data operations. Documentation checks verify relative link targets and matching command/version references.

## Historical macOS Desktop GUI evidence — 0.1.0

An isolated copy of the installed Electron app, using a separate synthetic home/profile, rendered the plugin details button and native management dialog. Selecting one parent previewed two group members; confirmed move reported one success and one trash entry, then confirmed restore reported one success with the archive list restored and trash empty. Select-all and clearing selection on page/tab changes were checked. The polished native **Move to trash** menu opened its preview, and a host-held fork showed **Pending restart**. The card layout, compact badges, and result details were visually inspected; screenshots matched accessibility state. The completed/title-free move and restore receipts and the restored synthetic parent log were independently checked.

## Verification limits

Physical cross-volume movement and machine power-loss tests were not performed. The implementation checks device identity and refuses cross-volume moves; synthetic/process-level crash states and boundary failures exercise recovery. Native programmatic permanent purge and pending cancellation passed; the final graphical purge and cancel-pending clicks were not verified. The isolated Electron copy inherited pre-existing local shell modifications; it was not a pristine-shell comparison. The official rc.3 runtime was tested independently. Windows Desktop GUI has not been visually exercised; its native integration and package checks above passed. The historical macOS GUI checks were not rerun for `0.1.1`, `0.1.2` or `0.1.3`. No new Desktop graphical storage-overview run was performed for `0.1.4`. The exact target does not imply compatibility with future DSH releases or other operating systems. Mutation targets were known synthetic sessions.

For `0.1.5`, the macOS graphical updater evidence currently covers review and cancellation only. Final graphical installation/restart and post-install retention checks remain incomplete pending manual unlock; automated native SDK success and package-admission rollback do not substitute for those clicks.
