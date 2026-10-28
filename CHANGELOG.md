# Changelog

[简体中文](CHANGELOG.zh-CN.md) · English

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
