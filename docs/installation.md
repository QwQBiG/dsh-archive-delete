# Installation and usage

[简体中文](installation.zh-CN.md) · English

Move archived conversations to trash, restore them, or permanently clear selected trash after confirmation. The plugin uses DSH's existing desktop interface.

## Supported setup

**Official DSH Desktop `0.2.1-rc.3` with official JSONL storage.** macOS and Windows are supported. Native integration and package installation passed on both platforms; Windows Desktop GUI has not been visually tested. Trash and sessions must be on the same volume. Windows storage must use canonical local absolute drive paths. UNC/network and device-namespace paths, directory junctions, and short-name aliases that resolve to a different path are unsupported; case-only aliases are accepted. Runtime checks disable operations when the required host capabilities are unavailable.

## Three steps

Install `v0.1.1` from GitHub:

```text
github:QwQBiG/dsh-archive-delete#v0.1.1
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

## Optional CLI: verify bundle registration

Prefer **Plugins → Add plugin**: DSH's plugin manager installs the package and registers its bundle. With a Desktop-enabled DSH CLI, use:

```sh
dsh plugin --profile desktop add github:QwQBiG/dsh-archive-delete#v0.1.1
```

A successful package-manager exit does not by itself prove activation. CLI builds and invocation modes can differ: a manager-enabled path can register the bundle automatically, while an installation-only path can leave it absent. If a standalone CLI rejects the reserved `desktop` profile, use Desktop's plugin manager rather than selecting a different profile. Check the active profile's manifest; quit Desktop before making a needed edit:

1. Open `<DSH_HOME>/profiles/desktop/package.json`. With the default home, this is `~/.dsh/profiles/desktop/package.json` on macOS and `$HOME\.dsh\profiles\desktop\package.json` on Windows. Use the application's actual home if `DSH_HOME` was changed.
2. Confirm the existing `dsh.profile.bundles` array contains `@qwqbig/dsh-archive-delete`. If absent, add it once. Keep every existing bundle and all other fields; the fragment below illustrates the one entry to add, not a replacement for the file.
3. Save valid JSON, start Desktop, and check the plugin's component state and management button.

```json
{
  "dsh": {
    "profile": {
      "bundles": ["@qwqbig/dsh-archive-delete"]
    }
  }
}
```

Installing the dependency without this entry leaves its files on disk but does not load `cordis.patch.yml`. Do not add an installation hook or approve build scripts to solve missing registration. Both host and browser artifacts are already included; GitHub installation needs no build/prepare script.

## Check that the plugin loaded

Check the plugin's component is running and its details contain **Manage archives and trash**. Open that button to confirm the management dialog responds. After a successful supported startup, `<DSH_HOME>/archive-delete/` contains `trash`, `staging`, `receipts`, and `operations`.

For the default home on macOS:

```sh
ls ~/.dsh/archive-delete
```

For the default home in Windows PowerShell:

```powershell
Get-ChildItem "$HOME\.dsh\archive-delete"
```

Use the actual `DSH_HOME` when customized. Directories can remain after an earlier run or removal, so their presence alone does not prove the current plugin is running.

## Installation troubleshooting

- **Package installed, no management button:** check the active profile, bundle registration above, and DSH's component diagnostics. `node_modules` presence alone is not activation.
- **Unsupported host:** the startup diagnostic and management dialog report the required and current DSH versions. Update Desktop to `0.2.1-rc.3` and restart the plugin. The package's `engines.dsh` is descriptive; pnpm does not enforce that field during installation.
- **Peer dependencies:** Cordis, app boot, home paths, native system bindings, and React are supplied by DSH. They are marked optional for the package manager; do not install a second set into the profile to silence warnings. Missing runtime capabilities still disable operations.
- **YAML duplicate-key error before installation:** inspect `<DSH_HOME>/profiles/desktop/pnpm-workspace.yaml`. A malformed `allowBuilds` mapping prevents any plugin installation. Back up the file, correct duplicated or malformed keys, and quote keys containing `:`; do not add repeated allow-build entries or enable build scripts for this package.
- **Node wrapper reports `exec: : not found`:** an internal Desktop wrapper may require `DSH_DESKTOP_NODE_EXECUTABLE` from the application's launch environment. Use the installed `dsh` command or the plugin manager. For development, use a real Node 24+ executable as described in [Contributing](../CONTRIBUTING.md).

## Local package for development

Use Node 24 or newer, a temporary home/profile, and synthetic conversations. Build and pack, then install the generated absolute `.tgz` path into that isolated profile:

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm pack
```

With DSH's CLI installed, create a fresh test home and install into its isolated `web` profile. In a POSIX shell:

```sh
DSH_ARCHIVE_DELETE_TEST_HOME="$(mktemp -d)"
DSH_HOME="$DSH_ARCHIVE_DELETE_TEST_HOME" dsh plugin --profile web add "$PWD/qwqbig-dsh-archive-delete-0.1.1.tgz"
```

Verify the isolated profile's bundle registration and activation as described above. Alternatively, install the local package through that isolated host's plugin manager. On Windows, use the automated isolated install/reinstall/remove check in [Contributing](../CONTRIBUTING.md). Keep the test-home path if launching that host manually. This does not install into the current Desktop profile. A packed artifact keeps development dependencies out of the host runtime; your primary history is not a fixture.

## Update or remove

Use DSH's plugin manager and follow its restart prompt. Removal preserves trash and pending/recovery records; reinstall a supported version to inspect them. Back up those records together with the trash.

For failures, retain the reported status and retry the specific target. Report host/plugin versions and a sanitized synthetic reproduction. Expected states are documented in [operation recovery](operations.md).
