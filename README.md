# dsh-archive-delete

[简体中文](README.zh-CN.md) · English

Move archived DSH conversations to a recoverable trash, directly inside the desktop app. Restore them when needed; permanently clear selected trash only after confirmation. Inspect DSH storage and one selected workspace without changing their files.

`@qwqbig/dsh-archive-delete` · **v0.0.2** · [Apache-2.0](LICENSE) · **DSH Desktop `0.2.1-rc.3` · official JSONL storage**

Supports **macOS and Windows**. See the [acceptance record](docs/acceptance.md) for verification status and Desktop GUI limits.

## What you get

- **Native controls:** an archived-conversation menu action and an **Archived / Trash / Storage overview** management dialog.
- **Clear scope:** preview selected conversations and their dedicated subagents, then see each result and retry a failed target.
- **A way back:** restore to the original workspace in archived state. A missing workspace becomes Ungrouped; existing paths are never overwritten.
- **Work without restarting:** a confirmed move can release a wholly idle, host-managed conversation through its native lifecycle, then move it now. Already-trashed records can be permanently cleared in the same process. Protected or unavailable release paths remain pending.
- **Storage at a glance:** manually scan DSH storage or one registered workspace; inspect categories, large files and top-level folders. The figures describe measured file bytes, not reclaimable space or identified AI output.
- **Updates you control:** check compatible stable GitHub releases daily, review the version and release notes, then confirm installation through DSH's native manager in the current profile.
- **A familiar interface:** the host language, theme, and native controls.

Trash never expires automatically. Removing the plugin keeps the trash.

## Install and use in three steps

In DSH Desktop, use **Plugins → Add plugin** with the versioned Release package:

```text
https://github.com/QwQBiG/dsh-archive-delete/releases/download/v0.0.2/qwqbig-dsh-archive-delete-0.0.2.tgz
```

1. **Install:** enter the address above and enable the plugin. When asked to restart, fully quit DSH and open it again: **⌘Q / Quit** on macOS, or the app's **Exit/Quit** command on Windows. Closing a window alone can leave the process running.
2. **Choose:** archive a conversation with DSH, then choose **Move to trash** in its native menu. For a batch, open the plugin details and **Manage archives, trash and storage**.
3. **Review:** check the targets and subagents, then confirm. Use **Trash** to restore selected groups or review **Delete permanently**.

**Pending restart** means the original logs are still in place; no space has been freed yet. Use **Cancel waiting and review** to retire the old queued request and open a fresh move preview, or **Cancel pending move** to withdraw it. Only the new confirmation attempts an immediate move. After a successful move, use **Trash → Delete permanently** without restarting. Active work, pending input, external writers, and an unavailable safe-release capability remain protected. Each page/batch holds up to 100 targets; select-all applies to that page. Changing pages, tabs or sort order clears selection. Archived and Trash lists offer default order or largest first.

The Release package contains the declared installable files and precompiled host/browser artifacts; it excludes source, tests, lockfiles, and CI configuration. Its [SHA-256 checksum](https://github.com/QwQBiG/dsh-archive-delete/releases/download/v0.0.2/qwqbig-dsh-archive-delete-0.0.2.tgz.sha256) is provided alongside it. Users do not need Git or a source build.

The plugin manager installs the package and registers its bundle in the active profile. CLI installation is an alternative for managed or unattended setups and requires checking registration. Use **Plugin updates** for future compatible releases; `pnpm update` does not track new Release assets. [Installation and usage](docs/installation.md) covers upgrades, CLI bundle cleanup on uninstall, profile scope, full restart, troubleshooting, and the read-only Doctor for configuration and access checks.

Unreadable records have their own warning while healthy records remain visible; uncertain relationships stay protected. Confirmations distinguish ready, idle-release and protected targets, and disable themselves when expired.

## Update from GitHub

Plugin details and the management dialog show a compact version/update row. **Details** expands the checking policy and last-check information; update controls are hidden while confirming a move, restore or permanent deletion. Updating is enabled only on supported DSH Desktop `0.2.1-rc.3` with a verified profile-owned installation and native manager; it is not a self-upgrade path on an unsupported future DSH version. DSH checks GitHub daily while running; **Check** permits another network check after at least one minute. A failed check is shown as an error, with an automatic retry after at least one hour; a longer GitHub rate-limit window is respected. It never means that the installed version is current, and checking never installs a package.

Choose **Review update**, read the version and plain-text notes, then **Confirm upgrade**. Only compatible stable releases of this package are accepted. The plugin checks the release metadata, package checksum and archive contents, saves a private verified package, then delegates installation to DSH for this profile. Conversations and trash are retained; archive changes pause during replacement. Follow any full-quit-and-reopen prompt to load the installed version. If the result is uncertain, recheck the confirmed request against the native installation; a recorded installation is not repeated. If it remains uncertain, fully quit and reopen DSH to reconcile before another upgrade.

GitHub remains the only distribution source. After an in-app upgrade, the profile's dependency can show `file:` pointing to `<DSH_HOME>/archive-delete/updates/packages/<version>-<sha256>.tgz`: this is the verified GitHub package kept for package-manager reproducibility. Keep that cache with the profile; there is no automatic cache cleanup. See [update behavior and recovery](docs/installation.md#updates-in-the-plugin) before removing any update files.

## Inspect storage

Open **Storage overview**, then choose **Scan DSH storage**, or select one registered workspace and choose **Scan selected workspace**. Opening the dialog or this tab does not start a scan; other projects are not scanned. You can cancel an active scan. Rescanning the same scope keeps the previous dated result visible, marked as an earlier observation, including after cancellation or failure; changing scope clears it. **Refresh workspace list** updates the choices; use a scan button again to update sizes.

DSH storage follows the running host's configured locations, which can extend beyond its data home. Workspace files come from that workspace's registered project directory. Valid registered project directories are excluded from the DSH scan even when they sit inside its data home; select the workspace to scan them separately. Results show measured categories, large files, top-level folder totals, observation time and any skipped or unavailable entries. Missing access or an unresolved location is shown as unknown or unavailable, never as a confirmed zero.

The main total counts verified duplicate paths and hard links once. It measures logical file bytes, not physical disk allocation or space that deletion would free; category and folder figures may overlap. A bounded scan can be partial. File origins remain unknown, so a large workspace file is not classified as disposable AI output. Storage overview provides no file-deletion action; use the existing Trash confirmation for conversation cleanup. [The usage guide](docs/installation.md) explains scan limits and size differences.

## What changes on disk

The plugin moves the selected parent and its explicitly owned subagent log directories, and updates their native DSH registration. Independent forks stay in place. Active work, uncertain relationships, unsafe paths, and another process's write lock block the operation.

Shared attachments, spill, project files, and other plugins' caches stay untouched. **Permanent deletion cannot be undone:** it removes selected trash logs and their recovery metadata, rather than promising erasure of every local or remote copy.

Version and capability checks disable data operations outside the supported target. A version mismatch is reported at startup with the required and current versions, plus an upgrade instruction; the same explanation is visible in the management dialog. See the [acceptance record](docs/acceptance.md) for actual verification and its limits.

## Development

Use Node **24 or newer** and the repository's pinned pnpm version. The host provides the five peer dependencies; they are optional in package-manager metadata and are still checked when the plugin starts. Tests use temporary profiles and synthetic conversations.

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm pack --pack-destination artifacts
node scripts/release-artifacts.mjs artifacts
node --import tsx scripts/check-update-package.mjs artifacts
```

Generated `lib` artifacts make GitHub installation runnable without a dependency `prepare` build. DSH and React are provided by the host.

## Documentation

- [Architecture](docs/architecture.md)
- [Operation states and recovery](docs/operations.md)
- [Acceptance evidence](docs/acceptance.md)
- [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md)
