# Installation and usage

[简体中文](installation.zh-CN.md) · English

## Supported setup

- Official DSH macOS Desktop `0.2.1-rc.3`.
- The official JSONL session store and a same-volume plugin trash location.
- No changes to the DSH application bundle, existing `dsh-purge`, or project working directories.

The plugin checks runtime capabilities. An unsupported result is not an invitation to bypass the version or path checks.

## GitHub installation

After `v0.1.0` has been published, open **Plugins → Add plugin** in the desktop app and enter:

```text
github:QwQBiG/dsh-archive-delete#v0.1.0
```

Install and enable the bundle. Restart only when DSH reports that the host half needs it. Use the plugin manager belonging to the actual desktop profile, rather than an unrelated CLI `web` profile.

For users who have explicitly installed DSH's CLI command, the equivalent command is:

```sh
dsh plugin --profile desktop add github:QwQBiG/dsh-archive-delete#v0.1.0
```

Both host and browser artifacts are included in the package. A GitHub user installation does not require a dependency build/prepare script.

## Local package for development

Use an isolated DSH home/profile populated only with synthetic conversations. Build and pack the source, then pass the resulting absolute `.tgz` path to that isolated profile's plugin manager:

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm pack
```

Installing a packed artifact avoids accidentally resolving development copies of DSH or React as a second host runtime. Do not use your main profile as the integration-test fixture.

## Archive and move

Use DSH's original archive action first. The plugin intentionally does not duplicate DSH's archiving workflow or silently stop active work.

In an archived session's native menu, choose **Move to trash**. For multiple sessions, open **Plugins → Archive Delete → Manage archives and trash**, select targets on **Archived**, review the impact, and confirm.

Selection belongs to the current tab. Switching tabs clears it. Batch results separate succeeded, pending, skipped, and failed targets; retry only the failed item after resolving its reason.

## Pending restart

An idle archived conversation may still be retained by the current host. The confirmed request can be saved as **Pending move to trash**. Its original logs remain where they were, and it remains in the archive list. Cancel it there if you change your mind.

The next plugin startup attempts the request once after recovery checks. Newly active, changed, unarchived, or unsafe targets are not moved using an old confirmation. A pending record does not mean space has already been reclaimed.

## Restore or purge

The **Trash** tab lists physically moved groups. **Restore** returns a conversation to its original workspace in archived state, or archived Ungrouped if that workspace no longer exists. Existing-path conflicts are reported without overwriting data.

**Delete permanently** requires a new preview and confirmation. It removes selected trash logs and recovery metadata, not shared attachments, spill, project files, other plugin caches, or remote copies. Trash has no automatic expiration.

## Remove or update

Remove/update through DSH's plugin manager and follow its restart instruction. Removing the plugin does not purge its trash or pending operation records. Reinstall the supported version to inspect retained records. Keep pending/recovery files together with the trash if making a backup; manually moving live internals is not a supported recovery workflow.

If an operation fails, retain its status and use the same specific target for retry. Report a sanitized reproduction with host/plugin versions. See [operation recovery](operations.md) for the expected states.
