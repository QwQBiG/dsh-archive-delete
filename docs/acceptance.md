# Acceptance and verification

[简体中文](acceptance.zh-CN.md) · English

## Evidence policy

Test fixtures use temporary directories and synthetic conversations. The user's primary `~/.dsh` history, project files, and `dsh-purge` are not test inputs. A passed unit test, an author-declared version range, and an actual host/UI integration run are recorded as different evidence.

At the initial research commit, implementation verification is **pending**. Before release, record exact commands, host/runtime versions, test counts, and material limits below. Do not replace pending checks with a claim inferred from source review.

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
| Documentation | English and Chinese files and links | Paired, equivalent commands/limits/version/release facts |

## Commands

```sh
pnpm verify
pnpm pack
```

`verify` is expected to cover build/type checks, unit tests, integration tests, bilingual documentation checks, and package validation. The actual result and any excluded environment must be recorded; a command listed here is not evidence that it passed.

## Verification record

- Supported target: official macOS DSH Desktop `0.2.1-rc.3`, official JSONL store.
- Reference baseline reviewed: Archive Manager `6b8babc7b7f8da44466c7bd611ad29e66408623c`.
- Implementation checks: pending during initial documentation/research.
- Native GUI run: pending during initial documentation/research.
- Package install/update/remove: pending during initial documentation/research.

The release must replace these pending entries with concrete evidence or explicitly document remaining limitations. Compatibility with future DSH releases and other operating systems is not implied.
