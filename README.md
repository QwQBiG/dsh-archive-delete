# dsh-archive-delete

[简体中文](README.zh-CN.md) · English

Move archived DSH conversations to a recoverable trash, directly inside the desktop app. Restore them when needed; permanently clear selected trash only after confirmation.

`@qwqbig/dsh-archive-delete` · [Apache-2.0](LICENSE) · **DSH Desktop `0.2.1-rc.3` · official JSONL storage**

Supports **macOS and Windows**. Native host integration and package installation are verified on both platforms; Windows Desktop GUI has not been visually tested. See the [acceptance record](docs/acceptance.md).

## What you get

- **Native controls:** an archived-conversation menu action and an **Archived / Trash** management dialog.
- **Clear scope:** preview selected conversations and their dedicated subagents, then see each result and retry a failed target.
- **A way back:** restore to the original workspace in archived state. A missing workspace becomes Ungrouped; existing paths are never overwritten.
- **Work without restarting:** a confirmed move can release a wholly idle, host-managed conversation through its native lifecycle, then move it now. Already-trashed records can be permanently cleared in the same process. Protected or unavailable release paths remain pending.
- **A familiar interface:** the host language, theme, and native controls.

Trash never expires automatically. Removing the plugin keeps the trash.

## Install and use in three steps

In DSH Desktop, use **Plugins → Add plugin** with the versioned Release package:

```text
https://github.com/QwQBiG/dsh-archive-delete/releases/download/v0.1.3/qwqbig-dsh-archive-delete-0.1.3.tgz
```

1. **Install:** enter the address above and enable the plugin. When asked to restart, fully quit DSH and open it again: **⌘Q / Quit** on macOS, or the app's **Exit/Quit** command on Windows. Closing a window alone can leave the process running.
2. **Choose:** archive a conversation with DSH, then choose **Move to trash** in its native menu. For a batch, open the plugin details and **Manage archives and trash**.
3. **Review:** check the targets and subagents, then confirm. Use **Trash** to restore selected groups or review **Delete permanently**.

**Pending restart** means the original logs are still in place; no space has been freed yet. Use **Cancel waiting and review** to retire the old queued request and open a fresh move preview, or **Cancel pending move** to withdraw it. Only the new confirmation attempts an immediate move. After a successful move, use **Trash → Delete permanently** without restarting. Active work, pending input, external writers, and an unavailable safe-release capability remain protected. Each page/batch holds up to 100 targets; select-all applies to that page. Changing pages or tabs clears selection.

The Release package contains the declared installable files and precompiled host/browser artifacts; it excludes source, tests, lockfiles, and CI configuration. Its [SHA-256 checksum](https://github.com/QwQBiG/dsh-archive-delete/releases/download/v0.1.3/qwqbig-dsh-archive-delete-0.1.3.tgz.sha256) is provided alongside it. Users do not need Git or a source build.

The plugin manager installs the package and registers its bundle in the active profile. CLI installation is an alternative for managed or unattended setups and requires checking registration. To upgrade a fixed URL, add the newer release's URL again; `pnpm update` does not track new Release assets. [Installation and usage](docs/installation.md) covers upgrades, CLI bundle cleanup on uninstall, profile scope, full restart, troubleshooting, and the read-only Doctor for configuration and access checks.

## What changes on disk

The plugin moves the selected parent and its explicitly owned subagent log directories, and updates their native DSH registration. Independent forks stay in place. Active work, uncertain relationships, unsafe paths, and another process's write lock block the operation.

Shared attachments, spill, project files, and other plugins' caches stay untouched. **Permanent deletion cannot be undone:** it removes selected trash logs and their recovery metadata, rather than promising erasure of every local or remote copy.

Version and capability checks disable data operations outside the supported target. A version mismatch is reported at startup with the required and current versions, plus an upgrade instruction; the same explanation is visible in the management dialog. See the [acceptance record](docs/acceptance.md) for actual verification and its limits.

## Development

Use Node **24 or newer** and the repository's pinned pnpm version. The host provides the five peer dependencies; they are optional in package-manager metadata and are still checked when the plugin starts. Tests use temporary profiles and synthetic conversations.

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm pack
```

Generated `lib` artifacts make GitHub installation runnable without a dependency `prepare` build. DSH and React are provided by the host.

## Documentation

- [Architecture](docs/architecture.md)
- [Operation states and recovery](docs/operations.md)
- [Acceptance evidence](docs/acceptance.md)
- [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md)
