# dsh-archive-delete

[简体中文](README.zh-CN.md) · English

Move archived DSH conversations to a recoverable trash, directly inside the desktop app. Restore them when needed; permanently clear selected trash only after confirmation.

`@qwqbig/dsh-archive-delete` · [Apache-2.0](LICENSE) · **DSH Desktop `0.2.1-rc.3` · official JSONL storage**

Supports **macOS and Windows**. Native host integration and package installation are verified on both platforms; Windows Desktop GUI has not been visually tested. See the [acceptance record](docs/acceptance.md).

## What you get

- **Native controls:** an archived-conversation menu action and an **Archived / Trash** management dialog.
- **Clear scope:** preview selected conversations and their dedicated subagents, then see each result and retry a failed target.
- **A way back:** restore to the original workspace in archived state. A missing workspace becomes Ungrouped; existing paths are never overwritten.
- **Safe waiting:** idle conversations still held by DSH can wait for the next startup. Cancel the request, or let the plugin recheck it before moving.
- **A familiar interface:** the host language, theme, and native controls.

Trash never expires automatically. Removing the plugin keeps the trash.

## Install and use in three steps

Install from GitHub with this address:

```text
github:QwQBiG/dsh-archive-delete#v0.2.0
```

1. **Install:** in DSH Desktop, open **Plugins → Add plugin**, enter the address, and enable it. Follow DSH's restart prompt.
2. **Choose:** archive a conversation with DSH, then choose **Move to trash** in its native menu. For a batch, open the plugin details and **Manage archives and trash**.
3. **Review:** check the targets and subagents, then confirm. Use **Trash** to restore selected groups or review **Delete permanently**.

**Pending restart** means the original logs are still in place; no space has been freed yet. Use **Cancel pending move** in Archived to withdraw the request. Each page/batch holds up to 100 targets; select-all applies to that page. Changing pages or tabs clears selection.

The plugin manager installs the package and registers its bundle. After CLI installation, verify bundle registration and add it if missing, following [installation and usage](docs/installation.md), before restarting DSH. Both host and browser artifacts are included; users do not need to build the plugin.

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
