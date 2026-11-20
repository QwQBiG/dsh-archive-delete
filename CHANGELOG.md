# Changelog

[简体中文](CHANGELOG.zh-CN.md) · English

## 0.0.6

- Support DSH Desktop `0.2.2-rc.3` alongside the supported `0.2.1-rc.3` and `0.2.1-rc.5` builds. Align host peer requirements and publish update metadata for each supported version.
- Doctor checks for Desktop's bundled plugin-manager runtime and distinguishes a missing runtime, a missing pnpm entry and an unreadable entry.
- Document how to replace a plugin after a Desktop upgrade and when the plugin reuses an update check.

## 0.0.5

- Move the tabs and refresh action to the top of the dialog. Keep recent results above the list and put help, diagnostics and deletion history in expandable sections.
- Show the storage total first. Open file types, largest files, folders or scan details as needed.
- Add a violet and pink plugin icon to DSH Desktop. The README walkthrough shows the new layout in use.

## 0.0.4

- Show the running host's idle-release status; expand it to see checks and reason codes.
- Log a warning when a capability fails again after recovery. Missing-owner warnings include diagnostic counts.
- Show recent permanent deletions with the completion time, conversation ID and log size. The last 30 days of history (up to 200 records) remain readable when archive operations are unavailable.
- List reason-code explanations in Doctor's selected language, and run a separate host probe for an isolated diagnostic report.
- Recheck archive operations with the original request after a timeout or an uncertain response. Startup finishes interrupted cancellations before queued moves and keeps later confirmations separate.
- Restore and rollback recreate a missing internal session bucket under the existing session store.
- Keep a separate receipt for each upgrade so rechecking an older request cannot start installation again. The version row reflects the latest update check, including after a clock rollback.
- Count SQLite companion files with the search index, use physical locations to exclude workspaces, and preserve valid POSIX filenames in storage results.

## 0.0.3

- Rebuild the recent-results index on the first read after its one-minute expiry, so edits to existing receipt files appear in the correct order.
- Log the host version and a specific reason code when an idle-release probe fails, once per reason.
- Add native-host tests for probe failure and recovery, checking that session owners remain in place until release can proceed.

## 0.0.2

- Support DSH Desktop `0.2.1-rc.3` and `0.2.1-rc.5` on macOS and Windows.
- Show compact storage categories and file-type totals, with type labels for large files.
- Keep the previous scan result visible while rescanning the same scope.
- Improve persistence during staging and permanent deletion, and list damaged-record diagnostics separately.
- Use each preview once, show when it expires, and make batch counts and localized times consistent.
- Index recent receipts and session relationships, and share the result of overlapping list refreshes.
- Recheck uncertain update results, keep tracking installation status and follow GitHub's retry delays. Check release checksums and metadata against the install package.

## 0.0.1

- Add native archived-session menu actions, recoverable trash and permanent deletion after confirmation.
- Process idle host-managed conversations immediately, keeping parent sessions and dedicated subagents together for moves and restoration.
- Scan DSH and workspace storage, select conversations in batches and sort largest first.
- Install from GitHub Releases, confirm updates in the plugin and run the included Doctor on macOS/Windows Desktop `0.2.1-rc.3`.
