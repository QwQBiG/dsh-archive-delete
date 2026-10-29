# Changelog

[简体中文](CHANGELOG.zh-CN.md) · English

## 0.1.6 — 2026-10-29

- Fix moving newly created idle sessions to trash: compare the host’s omitted delegation depth as the JSONL default `0`, while retaining strict session identity, real metadata-change, activity and write-lock checks.
- Keep normal plugin version/update status on one compact row, with details available on demand. Hide update controls while reviewing a move, restore or permanent deletion.
- Add native regressions using genuinely new factory-created parent/subagent sessions, preserving independent forks and refusing actual header changes.

## 0.1.5 — 2026-10-29

- Add daily compatible stable-release checks from this package's GitHub repository and a manually requested check with a one-minute minimum interval; failed checks remain errors and retry after one hour.
- Add update cards in plugin details and the management dialog, with running/installed versions, plain-text release notes and an explicit confirmation before installation.
- Verify pinned release metadata, SHA-256, bounded archive paths and packed package identity, compatibility and prebuilt files; refuse install hooks, runtime dependencies and unapproved/nonoptional peers.
- Keep verified GitHub packages in a private persistent cache and delegate replacement of this same package to the current profile's native DSH manager. Retain conversations and trash; record check and installation state separately.
- Pause and drain archive changes before replacement, preserve pending native installations through plugin disposal, and distinguish a newer on-disk version, restart requirements and uncertain outcomes.
- Keep first-time upgrades from older versions available through the versioned Release URL. GitHub remains the only distribution source; no automatic installation or cache cleanup is added.

## 0.1.4 — 2026-10-29

- Add a read-only **Storage overview** tab with manual scans of configured DSH storage or one registered workspace, category sizes, largest measured files and top-level folder totals.
- Bound metadata-only scans, support cancellation and disclose partial results, unavailable locations, overlaps and duplicate identities; do not classify project files as AI output or offer broader file cleanup.
- Add default/largest-first sorting for Archived and Trash, clearing selection when the order changes.
- Measure current remaining trash files with the confirmation fingerprint instead of reusing saved historical sizes, including after a partial purge.

## 0.1.3 — 2026-10-29

- Attempt native lifecycle release of wholly idle, host-managed archived groups after fresh manual confirmation, then recheck contents and locks before moving without restarting.
- Add **Cancel waiting and review** for existing pending requests: retire the old queue and open a fresh preview, with no move until another confirmation.
- Clarify that existing trash is permanently cleared in the current process; preserve active work, pending input, external writers and unknown ownership protections.
- Keep startup queue replay separate from the fresh-manual release path; unavailable release capabilities retain the pending fallback.
- Recheck the confirmed trash fingerprint while holding its native lease before restore or purge; refuse content changes racing with lock acquisition.

## 0.1.2 — 2026-10-29

- Recommend versioned GitHub Release `.tgz` assets and matching SHA-256 checksums; exclude repository-only files from the installed package.
- Explain fixed-URL upgrades by adding the new asset URL, profile-specific activation, full process restart, and verification/cleanup of stale bundle entries after CLI removal.
- Add an installation error table that distinguishes blocked builds, malformed profile YAML, missing dependencies/bundles, unsupported hosts, and Node wrapper failures.
- Add a read-only doctor for profile registration, installed artifacts, host version, and existing storage access; keep diagnosis separate from live activation proof or repair.
- Emit a versioned loaded log only after recovery and authenticated API registration succeed.

## 0.1.1 — 2026-10-28

- Support Windows Desktop with native path and lease handling for local-drive JSONL storage, reserving original and relocated lock identities together.
- Harden bounded metadata reads and platform-specific file/directory durability handling; reject Windows network/device paths, unsafe aliases, and symlink/junction redirection.
- Pass macOS and Windows CI for builds, native host integration, committed artifacts, package installation, and uninstall retention. Windows Desktop GUI has not been visually tested.
- Document CLI installation with a bundle-registration check and missing-entry repair, with the native plugin manager as the recommended install path.
- Mark all five host-provided peer dependencies optional for package managers while retaining runtime capability checks.
- Report incompatible host versions at startup with current/required versions and upgrade guidance, retaining a readable disabled management dialog.
- Add practical activation checks, profile YAML troubleshooting, and explicit Node 24 development requirements.

## 0.1.0 — 2026-10-28

- Move archived conversations to recoverable trash from their native menu or the plugin's **Manage archives and trash** dialog.
- Review up to 100 targets per page/batch before confirmation; changing pages or tabs clears selection. See individual results and retry a failed target. The interface follows DSH's language and theme.
- Keep parents and dedicated subagents together, preserve independent forks, and restore archived conversations to their original workspace without overwriting paths.
- Let idle host-held conversations wait for a checked next startup. Pending requests can be cancelled and stop when their content or archive state changes.
- Coordinate same-volume moves through durable request/transition journals, compatible leases, crash recovery, and idempotent results. Completed receipts retain no conversation titles.
- Rebuild official projection metadata from the original logs, preserving titles after a cache-domain reopen.
- Support official macOS DSH Desktop `0.2.1-rc.3` with JSONL persistence. Unsupported hosts, unsafe paths, unknown artifacts, active work, and external writers are refused.
- Clear trash only after explicit permanent confirmation. Shared attachments, spill, project files, other plugin caches, and trash after uninstall remain intact.
- Ship generated GitHub installation artifacts; no npm publication in this release.

See the [acceptance record](docs/acceptance.md) for exact verification and limits.
