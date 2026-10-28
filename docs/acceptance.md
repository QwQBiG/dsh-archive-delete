# Acceptance and verification

[简体中文](acceptance.zh-CN.md) · English

## Evidence policy

Mutation fixtures use temporary directories and known synthetic conversations. No plugin data operations were performed on the user's primary profile, project files, or existing plugins. A passed unit test, an author-declared version range, and an actual host/UI integration run are recorded as different evidence.

The scenario table defines the acceptance targets. The verification record below identifies what was exercised, with exact commands, host/runtime versions, counts, and material limits. Source review alone does not turn an unperformed check into a passed check.

## Required scenarios

| Area | Scenario | Required outcome |
| --- | --- | --- |
| Cold archived session | Preview, move, restart, restore, restart, purge | Log bytes and native bookkeeping agree with each visible state |
| Scope | Request an unarchived or unknown session | No source mutation; explicit rejection/skip |
| Ownership | Parent with explicit subagents and an independent fork | Subagents move with parent; fork remains intact and readable |
| Activity | Running turn, subagent, background job, schedule, or pending interaction | Group is not moved or queued as idle |
| Own-host lease | Idle session opened earlier in this process | Pending status; original logs remain; next startup rechecks |
| External lease | Another process holds `session.lock` | Refusal without stealing the lock |
| Pending cancellation | Cancel, restart | Target is not moved |
| Pending drift | Add content or unarchive after queuing | Old request does not move changed data |
| Pending retry | Still owned at next startup | Remains pending, no forced movement |
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
| Documentation | Links, commands, and version references | Existing relative targets and consistent documented commands/versions |

## Commands

```sh
pnpm verify
pnpm pack
node scripts/verify-package-lifecycle.mjs ./qwqbig-dsh-archive-delete-0.1.1.tgz
```

`verify` covers build/type checks, unit tests, native integration, documentation checks, and package validation. Use Node 24 or newer; the recorded local run used the Desktop-bundled Node/pnpm through `PATH`. The package lifecycle command is a separate check after `pack`.

## Verification record — 0.1.1

Date: 2026-10-28. Target: official DSH `0.2.1-rc.3`, JSONL backend, Node `24.21.0`, and pnpm `11.28.5`. CI uses a fresh isolated official runtime and temporary synthetic profiles. Both platform jobs below passed on the same verified commit, `7e434b4`, in the same matrix run. The final release retains that runtime unchanged; only package-version and documentation metadata were updated afterward.

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

Physical cross-volume movement and machine power-loss tests were not performed. The implementation checks device identity and refuses cross-volume moves; synthetic/process-level crash states and boundary failures exercise recovery. Native programmatic permanent purge and pending cancellation passed; the final graphical purge and cancel-pending clicks were not verified. The isolated Electron copy inherited pre-existing local shell modifications; it was not a pristine-shell comparison. The official rc.3 runtime was tested independently. Windows Desktop GUI has not been visually exercised; its native integration and package checks above passed. The historical macOS GUI checks were not rerun for `0.1.1`. The exact target does not imply compatibility with future DSH releases or other operating systems. Mutation targets were known synthetic sessions.
