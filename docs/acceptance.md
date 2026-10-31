# Verification

[简体中文](acceptance.zh-CN.md) · English

## Current results

Package `0.0.2`, official DSH Desktop `0.2.1-rc.3` / `0.2.1-rc.5`, JSONL storage. Local runtime: Node `24.21.0`, pnpm `11.28.5`.

| Check | Recorded result |
| --- | --- |
| Unit/client/service suite | 276 passed of 283; 3 Windows-only and 4 Electron-only skips in plain Node on macOS |
| Native host integration | 20 passed of 21; 1 Windows-only skip on macOS |
| Build/type, docs and package checks | Passed |
| Pack, checksums, update metadata and updater admission | Passed |
| Isolated install, URL replacement, uninstall/reinstall | Passed; bundle registration and retained trash checked |
| Installed rc.5 ASAR / Electron | 26 passed of 27 including native host and ASAR metadata checks; 1 Windows-only skip |
| macOS Desktop UI | Isolated loading, diagnostic display and preview checked |

Data tests use temporary profiles and synthetic conversations. Complete move/restore/purge flows are verified by native integration. Windows Desktop UI and physical whole-machine power-loss recovery remain unverified.

## Coverage

| Area | Checked behavior |
| --- | --- |
| Conversation lifecycle | Move, archived restore, same-process purge, parent/subagent groups and retained forks |
| Activity and leases | Idle release, active/input/maintenance refusal, native lease contention |
| Requests | Single-use previews, same-ID replay, expiry, cancellation, changed content and mixed batch results |
| Recovery | Failures across file/registration boundaries, partial purge, missing buckets and interrupted requests |
| Data layout | Damaged-entry isolation, manifests, unknown files, path conflicts, aliases and symlinks |
| Storage | Configured/workspace roots, file-type rules, path/hard-link deduplication, limits, changes and cancellation |
| Interface | Selection/page/sort, localized timestamps, maintenance races and previous-result rescans |
| Updates | Stable version selection, native profile ownership, pinned metadata, package checks and uncertain results |
| Distribution | Compiled package, checksum agreement, bundle registration, replacement and retained data |

Receipt-index measurements on a local 5,000-record fixture were about 24 ms for the first lookup and 0.8 ms median for warm lookups. Startup still inventories recovery records.

## Reproduce

Use Node 24+ and an installed official runtime. [Contributing](../CONTRIBUTING.md) explains runtime selection.

```sh
pnpm verify
pnpm pack --pack-destination artifacts
node scripts/release-artifacts.mjs artifacts
node --import tsx scripts/check-update-package.mjs artifacts
node scripts/verify-package-lifecycle.mjs ./artifacts/qwqbig-dsh-archive-delete-0.0.2.tgz
```

The package lifecycle command uses another temporary profile and local URL fixtures. Desktop UI checks are recorded separately from automated data tests.

[Architecture](architecture.md) · [Operations](operations.md) · [Installation](installation.md)
