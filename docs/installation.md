# Installation and usage

[简体中文](installation.zh-CN.md) · English

Move archived conversations to trash, restore them, or permanently clear selected trash after confirmation. The plugin uses DSH's existing desktop interface.

## Supported setup

**Official DSH Desktop `0.2.1-rc.3` with official JSONL storage.** macOS and Windows are supported; actual verification and GUI limits are recorded in [acceptance](acceptance.md). Trash and sessions must be on the same volume. Windows storage requires canonical local absolute drive paths. UNC/network and device-namespace paths, directory junctions, and short-name aliases that resolve to a different path are unsupported; case-only aliases are accepted. Runtime checks disable operations when required host capabilities are unavailable.

## Recommended: install in the desktop interface

Open **Plugins → Add plugin** and paste the versioned Release package URL:

```text
https://github.com/QwQBiG/dsh-archive-delete/releases/download/v0.1.5/qwqbig-dsh-archive-delete-0.1.5.tgz
```

1. **Add and enable.** The native manager installs the dependency and registers its bundle in the current profile. Fully quit and reopen DSH when it requests a restart.
2. **Choose archived conversations.** Archive with DSH's original action first. Choose **Move to trash** in the conversation menu, or plugin details → **Manage archives, trash and storage** for a batch.
3. **Review and confirm.** Check targets and dedicated subagents, then confirm. Results distinguish **Moved to trash**, **Pending restart**, **Skipped**, and **Failed**. Resolve the stated reason before retrying a specific failed target.

Release `.tgz` assets contain only the package's declared installable files, including precompiled `lib/` artifacts. Repository archives from `codeload` contain source, tests, lockfiles, and CI configuration as well; they are not the recommended install package. No source build, dependency `prepare`, or installation hook is needed. These versions are not published to npm.

For a downloaded package, retain its matching [SHA-256 file](https://github.com/QwQBiG/dsh-archive-delete/releases/download/v0.1.5/qwqbig-dsh-archive-delete-0.1.5.tgz.sha256). With both files in the same directory, check on macOS:

```sh
shasum -a 256 -c qwqbig-dsh-archive-delete-0.1.5.tgz.sha256
```

In Windows PowerShell, compare the reported hash with the checksum file:

```powershell
Get-FileHash .\qwqbig-dsh-archive-delete-0.1.5.tgz -Algorithm SHA256
Get-Content .\qwqbig-dsh-archive-delete-0.1.5.tgz.sha256
```

A fixed version URL identifies the chosen release; the checksum checks the downloaded file. No fixed byte-size claim is made across releases.

## Profile scope and a full restart

The bundle is enabled only in the profile where it is registered. Desktop normally uses `desktop`; `dsh web` normally uses `web`. Installing into one does not enable the other. Use the actual profile selected by your host, and its actual `DSH_HOME` when customized. Data paths come from that running host; profile names are not separate trash stores.

Closing a window is not necessarily quitting DSH. On macOS, use **⌘Q** or the application's **Quit** menu. On Windows, use DSH's **Exit/Quit** command, including its tray-menu exit if the app remains there. Reopen only after the application process has exited. Follow this full restart after install, upgrade, or removal when DSH asks for it.

## Using the tabs

| Tab / state | What to do | What happens |
| --- | --- | --- |
| Archived | Move selected to trash | Logs move with their dedicated subagents; independent forks stay |
| Pending restart | Cancel waiting and review, cancel the request, or leave queued | Fresh review retires the old queue; only its new confirmation attempts a safe immediate move. Otherwise original logs stay |
| Trash | Restore selected | Return archived to the original workspace, or archived Ungrouped if it is gone; never overwrite |
| Trash | Delete permanently | Review a new confirmation, then immediately remove only selected trash logs and recovery metadata; no host restart is required |
| Storage overview | Start a DSH or selected-workspace scan | Read file metadata and display sizes; no files are deleted |

Each page/batch contains up to 100 targets. **Select all** applies to the current page; changing pages, tabs or sort order clears selection. Archived and Trash lists support default order or largest first. A pending request does not free space. Changed, unarchived, newly active, or unsafe targets require a fresh review. Trash never expires automatically.

### Move and clear without restarting

A confirmed move first checks the complete parent/subagent group. When an archived group is wholly idle and the pinned host provides an unambiguous native lifecycle teardown, the plugin asks that lifecycle to finish and release its writer. It then checks the archived state, group, contents, activity and write leases again before moving logs. A content change during release requires another preview. Running work, maintenance, pending input, external writers, unknown ownership and an unavailable release capability are not forcibly closed.

For an existing **Pending restart** record, choose **Cancel waiting and review**. This cancels the old queued request and opens a fresh move preview; it does not execute the move. Confirm that preview to attempt processing now. If you close or cancel it, the old queue remains cancelled and the source logs remain. Once the result says **Moved to trash**, select the resulting Trash entry and confirm **Delete permanently** in the same app process. If safe release is unavailable, the move can remain pending rather than taking a lock by force.

Restart prompts during installation or upgrade concern loading the new plugin package. They are separate from permanently clearing records that have already reached Trash.

Shared attachments, spill, project files, other plugin caches, and remote copies are outside permanent cleanup. The confirmation shows the scope; permanent cleanup cannot be undone.

## Storage overview

Open plugin details → **Manage archives, trash and storage** → **Storage overview**. Choose **Scan DSH storage**, or choose one workspace from the registered list and then **Scan selected workspace**. Opening the window, selecting the tab or changing the workspace does not start a scan. No all-project scan runs in the background. **Refresh workspace list** refreshes the registered choices, not the measured sizes; start another scan to update the figures. **Cancel scan**, closing the dialog or changing tabs stops the current scan; a late result is not displayed as a new result.

### Locations and categories

**DSH storage** uses the running host's configured locations: session logs; this plugin's trash, staging, operation records and receipts; attachments and their cache; other DSH cache; settings storage; plugin profiles; spill; the configured search-index file; and other files in the DSH data home. A configured session, attachment, spill or settings location may be outside that home. Known child categories are excluded from their parent categories to avoid counting the same subtree twice. Valid registered project directories are also excluded from the DSH scan, including projects located inside the data home; only a separate selected-workspace scan reads them. An in-memory search index has no file to measure. Missing providers, unresolved locations, inaccessible paths and missing directories are reported distinctly from measured empty directories.

**Workspace** reads the project directory currently registered with DSH for the selected workspace. The browser submits the workspace ID, never a path. A drive root, the user home or its ancestors, a redirected path or a project inside protected DSH storage is refused; known host-data subdirectories within an otherwise admitted project are excluded. If the registration or path changes while scanning, select it again and rescan. Missing project directories are reported, not recreated.

### What the numbers mean

The main total is **logical file bytes** with verified duplicate paths and hard links counted once across categories. It is not exclusive physical disk allocation or a promise of free space after deletion. Per-category totals deduplicate within that category; overlapping categories must not be added together. Top-level folder totals count file paths, including hard-link aliases, and can differ from the main total. If file identity cannot be established, the result discloses that duplicate detection may be incomplete.

Categories appear largest first, with unmeasured categories last. Expand one for up to 20 largest measured files, up to 20 top-level folder totals and scan notes. Workspace file origins are **unknown**: the scan does not identify AI-generated files, judge whether they are needed, or authorize their deletion. The overview has no deletion control for attachments, caches, spill, profiles, receipts or project files. Only the existing Trash action permanently clears the confirmed conversation logs and recovery metadata.

The scanner reads filesystem metadata, not file contents; it does not run Git, programs or project commands. Each request is bounded to 50,000 entries, directory depth 32 and about 5 seconds of scan work. Links/junctions, redirected paths, other volumes, special files and unreadable entries are skipped. A limit, concurrent change or unsafe/unreadable skipped entry makes the result partial and is shown with its observation time. Results describe the scan window, not a fixed snapshot; rescan after files change. Cancellation does not undo an archive operation already confirmed separately. If a previous scan is still finishing, wait briefly before scanning again. Workspace changes or missing registration call for refreshing the workspace list and selecting again; an unsafe project path must be changed rather than repeatedly retried.

Trash rows and their previews measure the current remaining owned files rather than the original move's saved size. A partially completed purge therefore shows the remaining size when it is listed again. These row sizes exclude recovery metadata and lock files, so they need not equal the Storage overview's entire Trash category. Restore/purge still recheck the confirmed fingerprint while holding the native lease; a size display does not grant permission to mutate changed contents.

## CLI alternative: verify bundle registration

CLI installation is intended for managed or unattended setups where the caller can check the profile and restart the host. Use the native interface above for ordinary desktop installation; the two paths can differ in registration and package-manager environment handling. Fully quit Desktop before changing its profile from a separate CLI.

With a Desktop-enabled DSH CLI:

```sh
dsh plugin --profile desktop add https://github.com/QwQBiG/dsh-archive-delete/releases/download/v0.1.5/qwqbig-dsh-archive-delete-0.1.5.tgz
```

A successful package-manager exit alone does not prove activation. A manager-enabled CLI can register bundles automatically, while an installation-only path can leave them absent. If the standalone CLI rejects the reserved `desktop` profile, use Desktop's manager rather than selecting a different profile.

1. Open `<DSH_HOME>/profiles/desktop/package.json`: normally `~/.dsh/profiles/desktop/package.json` on macOS or `$HOME\.dsh\profiles\desktop\package.json` on Windows. Substitute the actual home/profile.
2. Confirm `dsh.profile.bundles` contains `@qwqbig/dsh-archive-delete`. If absent, add it once. Preserve every other entry and field. This fragment illustrates the one entry, not a replacement file:

```json
{
  "dsh": {
    "profile": {
      "bundles": ["@qwqbig/dsh-archive-delete"]
    }
  }
}
```

3. Save valid JSON, start DSH, and check the component and management dialog. Files in `node_modules` alone do not load `cordis.patch.yml`. Build-script approval cannot fix missing bundle registration.

## Check that the plugin loaded

Start the actual target host and check the plugin component is running, its details contain **Manage archives, trash and storage**, and the dialog responds. After successful recovery and authenticated API registration, the current startup emits a line like:

```text
[archive-delete] v0.1.5 loaded · target DSH 0.2.1-rc.3 (host 0.2.1-rc.3) · trash "/absolute/path/to/dsh-home/archive-delete/trash"
```

Use a fresh line from the current process and check its version/path. It is not emitted for disabled or failed startup. A configuration dump such as `--dump-config` may succeed even with an unresolved bundle; it does not prove startup or activation.

After a successful supported startup, `<DSH_HOME>/archive-delete/` contains `trash`, `staging`, `receipts`, and `operations`. For the default macOS home:

```sh
ls ~/.dsh/archive-delete
```

For the default Windows home in PowerShell:

```powershell
Get-ChildItem "$HOME\.dsh\archive-delete"
```

Use the actual `DSH_HOME` when customized. Directories can survive earlier runs and removal, so their presence alone is not live activation evidence.

## Read-only doctor

The package includes `lib/doctor.js` and the `dsh-archive-delete-doctor` binary. Doctor checks the selected profile's dependency and bundle entry, installed artifacts, the resolved host version, the four-directory storage layout, and trash write access. It does not edit profile files, create directories, repair storage, acquire session locks, or operate on conversations. A successful offline report is not proof that a host process loaded the plugin.

Use a **real Node 24+ executable**. On the default macOS Desktop installation, this uses the existing bundled Node and runtime:

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node" \
  "$HOME/.dsh/profiles/desktop/node_modules/@qwqbig/dsh-archive-delete/lib/doctor.js" \
  --home "$HOME/.dsh" --profile desktop \
  --runtime "/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh"
```

For Windows PowerShell, substitute the existing Node 24+ executable and runtime directory:

```powershell
& 'C:\path\to\node.exe' `
  "$HOME\.dsh\profiles\desktop\node_modules\@qwqbig\dsh-archive-delete\lib\doctor.js" `
  --home "$HOME\.dsh" --profile desktop `
  --runtime 'C:\path\to\dsh-runtime'
```

Use the actual home/profile when customized. `--runtime` is optional when the host can be resolved through the profile. If it is omitted and the host cannot be resolved, doctor reports a warning rather than guessing; an explicitly supplied invalid runtime fails the check. Add `--json` for structured output or `--lang en` / `--lang zh` for the report language; `--help` lists supported options. Missing data directories can mean the plugin has not started yet and are reported as warnings. Confirm current activation with the fresh loaded log and responsive management dialog above. Doctor never downloads another runtime.

## Updates in the plugin

An installation older than `0.1.5` needs one manual upgrade using the Release URL above; it does not yet contain the update controls. From `0.1.5`, open **Plugin updates** in plugin details or the management dialog.

### Check and confirm

Automatic checking starts only on supported DSH Desktop `0.2.1-rc.3`, with a verifiable profile-owned installation and the supported native manager. On an unsupported host, the existing compatibility gate remains in force; this updater is not a self-upgrade path on future DSH versions. While DSH is running, successful checks are cached for 24 hours. **Check for updates** requests a fresh check after a minimum interval of one minute; earlier clicks use the recorded result. A network, rate-limit or metadata failure remains an error, with an automatic retry after one hour. It does not establish that the installed version is up to date. No check downloads the full package or installs anything.

Only stable releases from `QwQBiG/dsh-archive-delete` are considered, with the exact required DSH version and a compatible macOS/Windows declaration. Choose **Review update** to read the version and plain-text notes, then **Confirm upgrade** to install. A changed release requires a fresh check and review. The browser supplies a candidate ID and request ID, never a URL or package path.

Installation replaces only this same plugin in the current profile through DSH's native manager. It does not install into other profiles, remove conversation history or empty the trash. Archive changes pause and already accepted work finishes before replacement. If the installed version differs from the running version, fully quit and reopen DSH when prompted; an in-app upgrade does not promise immediate activation without restarting.

### Verified package and retained cache

Before delegating installation, the plugin rechecks the release identity and metadata, downloads the confirmed package, verifies its exact size and SHA-256, and validates the bounded gzip/tar and packed manifest. It requires the expected name/version, exact DSH requirement, bundle patch and prebuilt files. Links, unsafe/duplicate archive paths, install hooks, runtime/optional/bundled dependencies and unapproved or nonoptional peers are refused. No files are extracted or package code executed during this verification.

The verified archive is saved privately as `<DSH_HOME>/archive-delete/updates/packages/<version>-<sha256>.tgz`. The native manager installs this local file, so the profile dependency can display a `file:` source instead of the GitHub URL. GitHub is still the sole distribution source; the local file is its verified retained install package. Keep it with the profile for package-manager reinstall/reproduction. There is no automatic cache cleanup, and the storage overview does not offer a delete action for these packages.

`updates/<sha256(profileId)>.check.json` stores check timing and public candidate details; `updates/<sha256(profileId)>.installation.json` independently records the install request and outcome. The server derives `profileId` from the canonical profile directory, so profiles sharing DSH home keep separate update records; verified packages share the `packages` directory. These records are not conversation backups. Removing the plugin retains them and the packages alongside the trash. Do not remove them as a routine install/uninstall step.

### Failure, unloading and uncertain outcomes

If the native manager is unavailable, the installation is built-in/ambiguous, or profile ownership cannot be established, use the manual Release URL path below. Network/integrity failures before native installation do not run the package. Native package-manager failures have manifest/lockfile rollback coverage, but failure while activating new plugin code cannot guarantee a complete rollback of the running application. Check diagnostics and the installed/running versions before retrying.

Closing the dialog does not cancel an already confirmed upgrade. Plugin unloading stops automatic checks but does not cancel or wait for an installation already delegated to the host: replacement itself can unload the old plugin, and waiting there could deadlock it. After interruption, **Check installation status** reconciles with the installed package. **Retry the same request** keeps its identity; do not start a second upgrade or treat a lost response as success. If the outcome is still unknown, fully quit and reopen DSH to reconcile it. Archive changes remain protected until the installed/running state is resolved or DSH is fully restarted.

## Manual upgrade of a fixed URL

Release URLs and fixed Git tags are version-pinned installation sources. `pnpm update` does not discover a new asset at a different URL, and an unchanging `main` archive URL is not a version-tracking mechanism. Choose a new published release, then add its **new versioned asset URL** through the same profile's plugin manager. The package name stays `@qwqbig/dsh-archive-delete`, so adding the new source replaces the existing dependency specification; removing it first is not required.

For CLI-managed setups, run the same `add` command above with the newer version in both the URL path and filename, verify the installed version and bundle registration, then fully restart. Keep the trash and recovery records. Do not overwrite one release's asset or retarget a published tag to simulate an upgrade. This project continues to distribute GitHub Release packages rather than publishing to npm.

## Uninstall and remove a stale bundle entry

Prefer the plugin manager's removal action. Fully restart when asked, then verify the active profile no longer selects this bundle. Different host builds/invocation modes may handle bundle cleanup differently.

For an installation-only CLI, quit Desktop completely, then remove the dependency:

```sh
dsh plugin --profile desktop remove @qwqbig/dsh-archive-delete
```

Open the same profile's `package.json` and remove **only** `@qwqbig/dsh-archive-delete` from `dsh.profile.bundles` if it remains. Preserve other bundles and fields, save valid JSON, and reopen DSH. A dependency removed without this cleanup can leave a repeated `skipping profile bundle … cannot resolve` startup diagnostic. Do not use package lifecycle hooks to edit a live profile automatically.

Removal retains `<DSH_HOME>/archive-delete/`, including trash, pending/recovery records, update journals and cached install packages. Reinstall a supported version to inspect them. Back up those records together with the trash and the profile; do not delete them as part of dependency removal. Resolve an in-progress or uncertain upgrade before starting another package replacement or removal.

## Installation troubleshooting

| Symptom | Likely boundary | What to check or do |
| --- | --- | --- |
| `ERR_PNPM_IGNORED_BUILDS` | A package's lifecycle script was blocked | Identify the named package in the log. This plugin's Release package requires no install build; blanket approval is not its fix. Review the affected package's need before allowing its own script. |
| `duplicated mapping key` | Invalid profile `pnpm-workspace.yaml` | Back up the file, repair duplicated/malformed `allowBuilds` keys, and quote keys containing `:`. Preserve unrelated policy; do not repeatedly append entries or delete the entire policy as a workaround. |
| `skipping profile bundle … cannot resolve` | Bundle selected but its package is absent/unresolvable | In that profile, reinstall the intended dependency or remove only the stale bundle entry after uninstall. Then actually start DSH. |
| Package present, no management button | Wrong profile, missing registration, or startup failure | Check the real profile, bundle array, startup diagnostics, and component state. A configuration dump or package directory alone is insufficient. |
| Unsupported host/version | Runtime admission failed | Read required/current versions in diagnostics and the management dialog. Use Desktop `0.2.1-rc.3` with the supported storage/capabilities. `engines.dsh` is descriptive, not a pnpm install gate. |
| Missing peer warnings from an older install | Old package metadata or missing runtime capabilities | Current host peers are optional. Check the installed plugin version and runtime diagnostics; do not install a second Cordis/React/native stack into the profile. |
| `exec: : not found` from the internal Node wrapper | Missing Desktop launch environment | Use the installed DSH command or native manager. Development/diagnostics need a real Node 24+ executable; see [Contributing](../CONTRIBUTING.md). |
| Update check fails or is rate-limited | GitHub/network request did not complete | Keep the installed version, inspect the diagnostic, and check again later; errors do not mean “up to date.” Automatic retry is after one hour. |
| Release or package verification fails | Changed metadata, checksum, compatibility or archive | Check again and review the current compatible release. Do not install an unverified file or bypass the confirmation. |
| Native updater unavailable | No supported manager or unambiguous profile-owned target | Use the manual fixed Release URL in this profile's native plugin manager. |
| New version installed but old version running, or outcome uncertain | Activation/restart or response interrupted | Follow the full-restart prompt, or check installation status/retry the same request. Preserve update records and cache. |

For failures, retain the reported status and retry the specific target. Report host/plugin versions and a sanitized synthetic reproduction. Expected operation states are documented in [recovery](operations.md).

## Local package for development

Use Node 24 or newer, a temporary home/profile, and synthetic conversations. Build and pack, then install the generated absolute `.tgz` path into that isolated profile:

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm pack --pack-destination artifacts
node scripts/release-artifacts.mjs artifacts
node --import tsx scripts/check-update-package.mjs artifacts
```

With DSH's CLI installed, create a fresh test home and install into its isolated `web` profile. In a POSIX shell:

```sh
DSH_ARCHIVE_DELETE_TEST_HOME="$(mktemp -d)"
DSH_HOME="$DSH_ARCHIVE_DELETE_TEST_HOME" dsh plugin --profile web add "$PWD/artifacts/qwqbig-dsh-archive-delete-0.1.5.tgz"
```

Verify the isolated profile's registration and activation as above. On Windows, use the automated isolated package lifecycle check in [Contributing](../CONTRIBUTING.md). Keep the temporary home path if launching that host manually. A packed artifact keeps development dependencies out of the runtime; primary history is not a fixture.
