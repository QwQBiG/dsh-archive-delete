# dsh-archive-delete

[简体中文](README.zh-CN.md) · English

A small, local-first recycle bin for archived DeepSeek Harness conversations. It integrates with DSH's own desktop interface: move archived conversations to trash, restore them, or permanently purge selected trash entries after confirmation.

Package: `@qwqbig/dsh-archive-delete` · License: [Apache-2.0](LICENSE)

## What it does

- Adds **Move to trash** to the native menu of an archived conversation.
- Opens a compact **Archived / Trash** dialog from the plugin's details page.
- Supports individual and batch operations, an impact preview, and per-item results.
- Keeps an idle conversation **Pending move to trash** when this DSH process still owns its write lock. The next plugin startup rechecks the request; you can cancel it meanwhile.
- Restores conversations to their previous workspace in the **archived** state. If that workspace no longer exists, restoration uses Ungrouped without recreating a project folder.
- Follows the DSH interface language, light/dark theme, and native interaction patterns.

Trash never expires automatically. Uninstalling the plugin does not empty it.

## Data boundary

An operation groups the selected parent conversation with its explicitly owned subagent conversations. Independent forks stay where they are. Running work, pending interactions, ambiguous relationships, unsafe paths, and another process's write lock block the operation.

The plugin handles session-log directories and the host bookkeeping needed for those sessions. It does **not** remove shared attachments, spill files, project files, or other plugins' caches. Permanent purge removes the selected local trash contents and their plugin recovery metadata. It is not a claim that every local or remote copy of a conversation has been erased.

Moving to trash is reversible. **Permanent purge cannot be undone.** The confirmation dialog explains the actual target and scope before either operation.

## Compatibility

The first supported target is **official DSH macOS Desktop `0.2.1-rc.3`**, with the official JSONL session-persistence backend. Version and capability checks disable mutations outside the supported combination rather than guessing internal shapes.

See the [acceptance record](docs/acceptance.md) for the verification performed on this repository. A declared target is not evidence that later DSH versions or other platforms have been tested.

## Install and use

After a release is available, open **Plugins → Add plugin** in DSH Desktop and enter:

```text
github:QwQBiG/dsh-archive-delete#v0.1.0
```

Install, enable, and restart DSH if its plugin manager requests it. Install into the profile your desktop app actually uses; installing a `web` profile does not change `desktop`.

1. Use DSH's existing archive action to archive a conversation.
2. Choose **Move to trash** in its native menu, or open **Plugins → Archive Delete → Manage archives and trash**.
3. Review the selected targets and subagents, then confirm.
4. Distinguish **Moved**, **Pending restart**, **Skipped**, and **Failed** results. A pending entry is still in the original store; no disk space has been released yet.
5. In **Trash**, select **Restore** or confirm **Delete permanently**. In **Archived**, use **Cancel pending** to withdraw a queued move.

See [installation and usage](docs/installation.md) for local-package installation and removal.

## Development

Use the Node and pnpm versions declared by the repository. Development and integration tests use temporary profiles and synthetic conversations, never your real DSH history.

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm pack
```

The GitHub install contains generated `lib` artifacts; users do not need to run a dependency `prepare` script. DSH and React remain host-provided dependencies.

## Documentation

Every user and developer document has an English and Simplified Chinese counterpart. Both versions are updated in the same change.

- [Research and reference baseline](docs/research.md)
- [Architecture and compatibility boundary](docs/architecture.md)
- [Operation states and crash recovery](docs/operations.md)
- [Acceptance scenarios and verification evidence](docs/acceptance.md)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

This project studies [DSH Archive Manager](https://github.com/MichengAI/dsh-archive-manager/tree/6b8babc7b7f8da44466c7bd611ad29e66408623c) as a reference. See [research](docs/research.md) for the exact baseline and the design decisions retained or changed.
