# Installation and usage

[简体中文](installation.zh-CN.md) · English

## Install in DSH Desktop

Use official DSH Desktop **0.2.1-rc.3 / 0.2.1-rc.5** on macOS or Windows, with JSONL storage.

Open **Plugins → Add plugin**, enter this URL, and enable the plugin:

```text
https://github.com/QwQBiG/dsh-archive-delete/releases/download/v0.0.4/qwqbig-dsh-archive-delete-0.0.4.tgz
```

The Release package is ready to use. If DSH asks for a restart, fully quit and reopen it: use **⌘Q / Quit** on macOS or **Exit/Quit** on Windows. If DSH stays in the Windows tray, quit from its tray menu too.

Install the plugin in the profile you use. Desktop normally uses `desktop`, while Web uses `web`; each profile loads its own plugins. Plugin data is stored under the host's `DSH_HOME`.

## Manage conversations

Open **Manage archives, trash and storage** in plugin details, or **Move to trash** in an archived conversation's menu.

Use the tabs and refresh control at the top of the dialog. The current operation result and alerts that need attention appear above the list.

| View | Action |
| --- | --- |
| Archived | Select conversations, review their subagents and confirm the move to trash |
| Pending restart | Review a fresh attempt to move now, or cancel the request |
| Trash | Restore selected conversations, or choose **Delete permanently** and confirm separately |
| Storage overview | Scan DSH or a selected workspace |

Select up to 100 targets at a time. Select-all covers the current page, and changing the page, tab or sort clears your selection. You can keep the default order or sort largest first.

DSH can release idle conversations and move them without a restart. Running tasks, pending input or another process holding a session can leave a group pending or blocked; check the result for the reason. To try a pending move again, choose **Cancel waiting and review**. This cancels the old request and opens a fresh confirmation.

Restored conversations return to their original workspace and stay archived. If that workspace is gone, they appear under Ungrouped. Damaged records show a notice with expandable details.

Trash stays until you clear it. Permanent deletion removes the selected conversation logs, dedicated subagent logs and recovery records, and cannot be undone. Shared attachments, spill files and project files stay in their own locations.

## Storage overview

Choose **Scan DSH storage**, or pick a registered workspace and choose **Scan selected workspace**. Scanning starts when you press the button. Use **Refresh workspace list** to update the choices or **Cancel scan** to stop a scan.

The summary shows the measured total and flags partial results. Expand a category or the workspace's **File types**, **Largest files** or **Top-level folders** sections to see what uses the space. Expand **Statistics details** for scan notes.

A DSH scan covers the host's configured storage locations and excludes registered project directories. To inspect a project, select its workspace instead. When you scan the same location again, the previous result and timestamp stay visible until the new result is ready. If you cancel or the scan fails, that result remains marked as an earlier observation. Choosing a different scope clears it.

Sizes use the logical length of each file. The overall total counts verified duplicate paths and hard links once. Category totals may overlap, so they should not be added together. A scan covers up to 50,000 entries, 32 directory levels and about 5 seconds of work; limits and access problems appear as partial coverage and skipped entries. Storage inspection is read-only. File types describe the layout and format of files; their contents determine their purpose.

## Updates

If you use **v0.0.1**, enter the v0.0.4 URL above in **Plugins → Add plugin**. The manager replaces the existing installation. After that, you can upgrade through the version row.

The version row at the bottom of the management dialog is also available in plugin details. It has **Check**, **Review update** and **Details**. The plugin checks GitHub daily. Manual checks must be at least one minute apart. After a failure, it waits at least one hour before retrying, or longer if GitHub requires it.

Choose **Review update**, read the release notes, then **Confirm upgrade**. The plugin verifies the package and asks DSH's manager to replace it in the current profile. If the installed version differs from the running version, fully quit and reopen DSH to load it.

If the result is unclear, choose **Check installation status** or **Recheck confirmed request**. These read the current state of the request without repeating a recorded installation. If the result is still unclear, fully quit and reopen DSH before trying again.

Verified update packages stay in `<DSH_HOME>/archive-delete/updates/packages/`, so the profile may show a `file:` dependency after an upgrade. Keep these files with the profile for reinstalls. Updates use the network and proxy settings of the environment that launched DSH.

To upgrade manually, add the new version's Release URL through **Add plugin** in the same profile. The manager recognizes the package name and replaces its dependency. With URL-based installation, use the new URL for each version; `pnpm update` cannot discover it.

## CLI installation and bundle registration

For everyday use, install through the Desktop plugin manager. If you manage the Desktop profile through the CLI, quit DSH first:

```sh
dsh plugin --profile desktop add https://github.com/QwQBiG/dsh-archive-delete/releases/download/v0.0.4/qwqbig-dsh-archive-delete-0.0.4.tgz
```

Check `<DSH_HOME>/profiles/desktop/package.json`. `dsh.profile.bundles` must contain the package name once. Add the entry if the CLI only installed the dependency, preserving the other fields:

```json
{
  "dsh": {
    "profile": {
      "bundles": ["@qwqbig/dsh-archive-delete"]
    }
  }
}
```

Start DSH and open the management dialog. If a standalone CLI rejects the reserved `desktop` profile, use the Desktop manager.

## Loading and Doctor

To check that the plugin has loaded, open its management dialog and look for a running component in the plugin details. A successful startup also writes this log line:

```text
[archive-delete] v0.0.4 loaded · target DSH 0.2.1-rc.3 / 0.2.1-rc.5 (host 0.2.1-rc.5) · trash "/absolute/path/to/dsh-home/archive-delete/trash"
```

If the plugin does not load, Doctor can check profile registration, package files, the host version and storage access. Use Node 24+ and substitute your actual home, profile and runtime paths:

```sh
ELECTRON_RUN_AS_NODE=1 \
  "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" --expose-internals \
  "$HOME/.dsh/profiles/desktop/node_modules/@qwqbig/dsh-archive-delete/lib/doctor.js" \
  --home "$HOME/.dsh" --profile desktop \
  --runtime "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh"
```

```powershell
& 'C:\path\to\node.exe' `
  "$HOME\.dsh\profiles\desktop\node_modules\@qwqbig\dsh-archive-delete\lib\doctor.js" `
  --home "$HOME\.dsh" --profile desktop `
  --runtime 'C:\path\to\dsh-runtime'
```

`--runtime` is optional when Doctor can resolve it through the profile. Use `--json` for structured output and `--lang en` or `--lang zh` to choose the language. Doctor reads configuration and access permissions; the startup log and management dialog show whether the current instance has loaded the plugin.

## Uninstall

Use the plugin manager's uninstall action. For CLI removal, quit DSH, then run:

```sh
dsh plugin --profile desktop remove @qwqbig/dsh-archive-delete
```

Remove this package's entry from the same profile's `dsh.profile.bundles` if it remains. Reopen DSH. `<DSH_HOME>/archive-delete/` retains trash, recovery records and update packages for a later reinstall.

## Download checksum

To verify a downloaded package, save the matching [SHA-256 file](https://github.com/QwQBiG/dsh-archive-delete/releases/download/v0.0.4/qwqbig-dsh-archive-delete-0.0.4.tgz.sha256) beside a downloaded package:

```sh
shasum -a 256 -c qwqbig-dsh-archive-delete-0.0.4.tgz.sha256
```

```powershell
Get-FileHash .\qwqbig-dsh-archive-delete-0.0.4.tgz -Algorithm SHA256
Get-Content .\qwqbig-dsh-archive-delete-0.0.4.tgz.sha256
```

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Installed package, no management button | Check the current profile, bundle entry and startup log |
| `skipping profile bundle … cannot resolve` | Reinstall the dependency, or remove its stale bundle entry after uninstall |
| Unsupported host | Use Desktop `0.2.1-rc.3` / `0.2.1-rc.5` with JSONL storage; the dialog reports the detected version |
| `ERR_PNPM_IGNORED_BUILDS` | Check which package requests a script; this Release package is precompiled |
| `duplicated mapping key` | Repair duplicate/malformed `allowBuilds` keys in the profile's `pnpm-workspace.yaml`; quote keys containing `:` |
| Internal Node wrapper reports `exec: : not found` | Use the Desktop manager or a real Node 24+ executable for development/Doctor |
| GitHub check fails or is limited | Check the runtime's network/proxy environment and retry after the displayed wait |
| Package verification fails | Check again and review the current release |
| Installed and running versions differ | Fully quit and reopen DSH |
| Damaged-record notice or failed transition | Keep the diagnostic and use [operation recovery](operations.md) |

## Diagnostics and deletion history

Expand **Help and diagnostics** below the list for the host's idle-release checks, retention notes and the previous operation result. Choose **Refresh** to run the host checks again. When no sessions are loaded, session-specific checks remain untested.

In **Trash**, expand **Recent permanent deletions** to see conversation IDs, confirmation times and sizes. It shows up to 200 records from the last 30 days and stays readable when archive operations are unavailable. See [operations](operations.md) for retention and recovery details.

Doctor can also display the full reason-code reference without inspecting a profile:

```sh
node lib/doctor.js --codes --lang en
node lib/doctor.js --codes --lang zh --json
```

Run these commands from the built checkout with Node 24+. For an isolated host report, follow the [contributing guide](../CONTRIBUTING.md).

[Development](../CONTRIBUTING.md) · [Verification](acceptance.md)
