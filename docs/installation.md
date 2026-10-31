# Installation and usage

[简体中文](installation.zh-CN.md) · English

## Install in DSH Desktop

Requires official DSH Desktop **0.2.1-rc.3 / 0.2.1-rc.5**, JSONL storage, and macOS or Windows.

Open **Plugins → Add plugin**, enter this URL, and enable the plugin:

```text
https://github.com/QwQBiG/dsh-archive-delete/releases/download/v0.0.2/qwqbig-dsh-archive-delete-0.0.2.tgz
```

The Release package contains compiled files. If DSH requests a restart, use **⌘Q / Quit** on macOS or **Exit/Quit** on Windows, including the tray menu when present, then reopen it.

Installation applies to the selected profile: Desktop normally uses `desktop`, and Web uses `web`. Data paths come from that host's `DSH_HOME`.

## Manage conversations

Open **Manage archives, trash and storage** in plugin details, or **Move to trash** in an archived conversation's menu.

| View | Action |
| --- | --- |
| Archived | Select conversations, preview the group and confirm moving to trash |
| Pending restart | Cancel waiting and review a new move, or cancel the request |
| Trash | Restore selected groups or confirm permanent deletion |
| Storage overview | Scan DSH or a selected workspace |

A batch holds up to 100 targets. Select-all applies to the current page; changing page, tab or sort clears selection. Default and largest-first sorting are available.

Idle host-managed conversations can move immediately. Running tasks, pending input and external writers keep a group pending or blocked; the result explains the reason. **Cancel waiting and review** ends the old queue and opens a fresh confirmation.

Restore returns a conversation to its original workspace in archived state. A missing workspace becomes Ungrouped. Damaged records have a diagnostic notice beside the healthy list.

Permanent deletion removes the selected trash logs, dedicated subagent logs and recovery records. It cannot be undone. Shared attachments, spill and project files remain in their own locations. Trash has no automatic expiry.

## Storage overview

Choose **Scan DSH storage**, or select one registered workspace and **Scan selected workspace**. Scans start when you press a scan button. **Refresh workspace list** updates the choices; **Cancel scan** stops the current scan.

The compact category list highlights measured storage. Details contain large files, top-level folders and scan notes. File types are classified from directory names and extensions: dependencies, build folders, version-control data, logs, media, archives, code/configuration, documents and other files. Large files carry the corresponding type label.

DSH scans use the host's configured locations and exclude registered project directories. A workspace scan uses that workspace's project directory. Same-scope rescans retain the previous result and timestamp while updating; cancellation or failure keeps that result marked as an earlier observation. Choosing another scope clears it.

Sizes are logical file bytes. The main total deduplicates verified paths and hard links; categories can overlap. Each scan covers up to 50,000 entries, depth 32 and about 5 seconds of work. The result shows partial coverage and skipped entries when a limit or access issue is encountered. File-type classification describes file layout; use the files themselves to decide their purpose. Storage inspection is read-only.

## Updates

To upgrade from **v0.0.1**, enter the v0.0.2 URL at the top of this guide in **Plugins → Add plugin**. The manager replaces the existing installation. Subsequent upgrades use the version row.

The version row provides **Check**, **Review update** and **Details**. GitHub checks run daily, with a one-minute manual interval. Failed checks retry after at least one hour and follow longer GitHub rate-limit windows.

Choose **Review update**, read the notes, then **Confirm upgrade**. The plugin verifies the package and delegates replacement to DSH's manager in the current profile. When the running and installed versions differ, fully quit and reopen DSH.

For an uncertain result, use **Check installation status** or **Recheck confirmed request**. The same request reads current installation state; a recorded installation is not repeated. If it remains unresolved, fully quit and reopen DSH before another attempt.

Verified packages stay in `<DSH_HOME>/archive-delete/updates/packages/`. A profile dependency can therefore use a `file:` source. Keep these files with the profile for reinstalls. Network access follows the launched runtime environment; proxy setup belongs there.

For a manual upgrade, add the new versioned Release URL through **Add plugin** in the same profile. The package name stays the same, so the manager replaces its dependency. `pnpm update` does not discover a new Release URL.

## CLI installation and bundle registration

Use Desktop's interface for ordinary installation. For a CLI-managed Desktop profile, quit DSH first:

```sh
dsh plugin --profile desktop add https://github.com/QwQBiG/dsh-archive-delete/releases/download/v0.0.2/qwqbig-dsh-archive-delete-0.0.2.tgz
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

The plugin component should be running and its management dialog should respond. A successful startup also logs:

```text
[archive-delete] v0.0.2 loaded · target DSH 0.2.1-rc.3 / 0.2.1-rc.5 (host 0.2.1-rc.5) · trash "/absolute/path/to/dsh-home/archive-delete/trash"
```

Doctor checks profile registration, package files, host version and storage access. Run it with Node 24+; substitute the actual home/profile/runtime:

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

`--runtime` can be omitted when resolvable through the profile. `--json` gives structured output; `--lang en` or `--lang zh` chooses the report language. Doctor is an offline read-only check; use the current loaded log and dialog to verify a running instance.

## Uninstall

Use the plugin manager's uninstall action. For CLI removal, quit DSH, then run:

```sh
dsh plugin --profile desktop remove @qwqbig/dsh-archive-delete
```

Remove this package's entry from the same profile's `dsh.profile.bundles` if it remains. Reopen DSH. `<DSH_HOME>/archive-delete/` retains trash, recovery records and update packages for a later reinstall.

## Download checksum

Keep the matching [SHA-256 file](https://github.com/QwQBiG/dsh-archive-delete/releases/download/v0.0.2/qwqbig-dsh-archive-delete-0.0.2.tgz.sha256) beside a downloaded package:

```sh
shasum -a 256 -c qwqbig-dsh-archive-delete-0.0.2.tgz.sha256
```

```powershell
Get-FileHash .\qwqbig-dsh-archive-delete-0.0.2.tgz -Algorithm SHA256
Get-Content .\qwqbig-dsh-archive-delete-0.0.2.tgz.sha256
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

[Development](../CONTRIBUTING.md) · [Verification](acceptance.md)
