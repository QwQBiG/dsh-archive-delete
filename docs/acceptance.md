# Verification

[简体中文](acceptance.zh-CN.md) · English

## 0.0.4

| Check | Local result |
| --- | --- |
| Unit, client and service tests on Node 24.21.0 | 420 passed, 7 skipped for platform or runtime, 0 failed |
| Native integration on the installed macOS DSH `0.2.1-rc.5` | 22 passed, 1 Windows-only skip, 0 failed |
| Existing purge history while the store is locked | Recent entries returned, expired entries filtered, history file remained byte-for-byte identical |
| Isolated host probe | Passed with session-owner checks reported as untested |

The [CI matrix](https://github.com/QwQBiG/dsh-archive-delete/actions/workflows/ci.yml) covers macOS and Windows with DSH `0.2.1-rc.3` and `0.2.1-rc.5`. It includes the native suite, package and update metadata validation, and isolated installation, upgrade and removal.

## Published 0.0.3

The published `0.0.3` package was checked with official DSH Desktop `0.2.1-rc.3` / `0.2.1-rc.5` and JSONL storage. Local checks used Node `24.21.0` and pnpm `11.28.5`.

| Check | Recorded result |
| --- | --- |
| Unit, client and service tests | 287 of 294 passed; 3 Windows-only and 4 Electron-only tests skipped in plain Node on macOS |
| Native host integration | 21 of 22 passed; 1 Windows-only test skipped on macOS |
| Build/type, docs and package checks | Passed |
| macOS / Windows × rc.3 / rc.5 | Passed across the [CI matrix](https://github.com/QwQBiG/dsh-archive-delete/actions/workflows/ci.yml), including native package installation and lifecycle tests |
| Packaging, checksums, update metadata and update-package validation | Passed |
| Isolated install, URL replacement, uninstall/reinstall | Passed; bundle registration and retained trash checked |
| Installed rc.5 ASAR / Electron | 27 of 28 passed, covering the native host and ASAR metadata; 1 Windows-only test skipped |
| macOS Desktop UI | Isolated loading, diagnostic display and preview checked |

Data tests use synthetic conversations in temporary profiles. Native integration tests cover the full move, restore and permanent-delete flows. Windows Desktop UI and recovery after an actual machine power loss remain unverified.

## Coverage

| Area | Checked behavior |
| --- | --- |
| Conversation lifecycle | Move to trash, restore as archived, same-process purge, parent/subagent groups and retained forks |
| Activity and write locks | Idle release, refusal during active work/input/maintenance, and native lock contention |
| Requests | Single-use previews, same-ID replay, expiry, cancellation, changed content and mixed batch results |
| Recovery | Failures between file operations and host registration, partial purge, missing buckets and interrupted requests |
| Data layout | Damaged-entry isolation, manifests, unknown files, path conflicts, aliases and symlinks |
| Storage | Configured/workspace roots, file-type rules, path/hard-link deduplication, limits, changes and cancellation |
| Interface | Selection, pagination, sorting, localized timestamps, maintenance races and rescans that retain the previous result |
| Updates | Stable-version selection, native profile ownership, pinned metadata, package checks and uncertain outcomes |
| Distribution | Compiled package, checksum agreement, bundle registration, replacement and retained data |

For a local fixture of 5,000 receipts, the first lookup took about 27 ms, cached lookups had a median of 0.74 ms, and rebuilding an expired index took about 19 ms. Startup also scans recovery records.

## Reproduce

Use Node 24+ and an installed official DSH runtime. See [Contributing](../CONTRIBUTING.md) to select the runtime.

```sh
pnpm verify
pnpm pack --pack-destination artifacts
node scripts/release-artifacts.mjs artifacts
node --import tsx scripts/check-update-package.mjs artifacts
node scripts/verify-package-lifecycle.mjs artifacts
```

The package lifecycle command runs in its own temporary profile with local test URLs. Desktop UI checks are recorded separately from the automated data tests.

[Architecture](architecture.md) · [Operations](operations.md) · [Installation](installation.md)
