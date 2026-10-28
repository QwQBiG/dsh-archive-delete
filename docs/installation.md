# Installation and usage

[简体中文](installation.zh-CN.md) · English

Move archived conversations to trash, restore them, or permanently clear selected trash after confirmation. The plugin uses DSH's existing desktop interface.

## Supported setup

**Official macOS DSH Desktop `0.2.1-rc.3` with official JSONL storage.** Trash and sessions must be on the same volume. Runtime checks disable operations when the required host capabilities are unavailable.

## Three steps

Install `v0.1.0` from GitHub:

```text
github:QwQBiG/dsh-archive-delete#v0.1.0
```

1. **Add and enable.** Paste the address in Desktop's **Plugins → Add plugin** and follow DSH's restart prompt. Use the actual Desktop profile; installing into `web` does not change `desktop`.
2. **Choose archived conversations.** Use DSH's original archive action first. Choose **Move to trash** in the conversation menu, or open the plugin details → **Manage archives and trash** for a batch.
3. **Review and confirm.** Check targets and dedicated subagents, then confirm. Results distinguish **Moved to trash**, **Pending restart**, **Skipped**, and **Failed**; retry a specific failed target after resolving its reason.

Each page and batch contains up to 100 targets. **Select all** applies to the current page; changing pages or tabs clears selection, so hidden selections are never carried into another action.

## Using the two tabs

| Tab / state | What to do | What happens |
| --- | --- | --- |
| Archived | Move selected to trash | Logs move with their dedicated subagents; independent forks stay |
| Pending restart | Cancel pending move, or leave queued | Original logs stay until a checked startup attempt can move them |
| Trash | Restore selected | Return archived to the original workspace, or archived Ungrouped if it is gone; never overwrite |
| Trash | Delete permanently | Review a new confirmation, then remove only selected trash logs and recovery metadata |

A pending request does not free disk space. Changed, unarchived, newly active, or unsafe targets cannot move under an old confirmation. Trash never expires automatically.

Shared attachments, spill, project files, other plugin caches, and remote copies are outside permanent cleanup. The confirmation shows the scope; permanent cleanup cannot be undone.

## Optional CLI

If DSH's CLI is already installed:

```sh
dsh plugin --profile desktop add github:QwQBiG/dsh-archive-delete#v0.1.0
```

Both host and browser artifacts are included. GitHub installation does not require a dependency build/prepare script.

## Local package for development

Use a temporary home/profile with synthetic conversations, then install the generated absolute `.tgz` path into that isolated profile:

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm pack
```

With DSH's CLI installed, create a fresh test home and install into its isolated `web` profile:

```sh
DSH_ARCHIVE_DELETE_TEST_HOME="$(mktemp -d)"
DSH_HOME="$DSH_ARCHIVE_DELETE_TEST_HOME" dsh plugin --profile web add "$PWD/qwqbig-dsh-archive-delete-0.1.0.tgz"
```

Keep the test-home path if launching that host manually. This does not install into the current Desktop profile. A packed artifact keeps development dependencies out of the host runtime; your primary history is not a fixture. For the automated isolated install/reinstall/remove check, see [Contributing](../CONTRIBUTING.md).

## Update or remove

Use DSH's plugin manager and follow its restart prompt. Removal preserves trash and pending/recovery records; reinstall a supported version to inspect them. Back up those records together with the trash.

For failures, retain the reported status and retry the specific target. Report host/plugin versions and a sanitized synthetic reproduction. Expected states are documented in [operation recovery](operations.md).
