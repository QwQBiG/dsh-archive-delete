# Changelog

[简体中文](CHANGELOG.zh-CN.md) · English

## 0.0.1 — Initial public release

- Move archived conversations to recoverable trash from their native DSH menu or the **Archived / Trash / Storage overview** dialog. Review up to 100 targets per page/batch, sort default/largest-first, and see individual results and retries; changing page, tab or sort clears selection.
- Keep a parent and its dedicated subagents together, preserve independent forks and original log bytes, and restore archived conversations to their original workspace. Missing workspaces become Ungrouped; existing paths are never overwritten.
- After fresh manual confirmation, use the admitted native lifecycle to release wholly idle managed groups, then recheck contents, activity and write leases before moving without restarting. Active work, pending input, external writers and unknown ownership remain protected; an unavailable safe release leaves a cancellable pending request. **Cancel waiting and review** requires a new preview and confirmation.
- Permanently clear only selected trash logs and recovery metadata after explicit confirmation, in the current process. Trash never expires automatically, remains after uninstall, and does not delete shared attachments, spill, project files, other caches or remote copies.
- Coordinate moves, restoration and partial purge through durable transition/request records, compatible leases, crash recovery and idempotent outcomes. Measure current remaining trash bytes with the confirmation fingerprint and recheck under the native lease; completed receipts retain no conversation titles.
- Provide bounded, cancellable, metadata-only storage inspection for configured DSH locations or one explicitly selected registered workspace. Show categories, largest files, top-level folders, logical bytes and partial/unavailable states; deduplicate verified paths/hard links without claiming reclaimable disk space or AI provenance. Storage inspection offers no file-deletion action.
- Keep update status on one compact row with optional details, and hide update controls during conversation confirmations. Check compatible stable GitHub releases daily, allow manual checks after one minute, and retain failed-check errors with a one-hour retry. Plain-text release notes and another explicit confirmation precede installation.
- Verify release identity, SHA-256, bounded archive paths, package identity/compatibility and prebuilt files before the current profile's native manager replaces this same plugin. Refuse install hooks, runtime dependencies and unapproved/nonoptional peers. Retain private verified packages, isolate update journals per profile, pause/drain archive changes, and distinguish running/installed versions, restart requirements and uncertain outcomes. No silent installation or automatic package-cache cleanup is added.
- Support official macOS and Windows Desktop `0.2.1-rc.3` with JSONL persistence, native paths/leases, host-provided React/DSH components, language/theme support and keyboard controls. Version/capability checks refuse unsupported hosts, unsafe paths, ambiguous relationships and changed source data.
- Include a read-only Doctor for registration, packaged artifacts, host version and existing storage access. Emit a versioned loaded signal only after recovery and authenticated API registration succeed.
- Distribute precompiled GitHub Release `.tgz` packages with SHA-256 and update metadata, under Apache-2.0. Installation needs no Git, source build or dependency prepare hook; no npm publication is required. Development and verification use Node 24 or newer and isolated synthetic profiles.

See the [acceptance record](docs/acceptance.md) for actual verification and limits.
