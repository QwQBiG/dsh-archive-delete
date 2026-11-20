# Contributing

[简体中文](CONTRIBUTING.zh-CN.md) · English

The plugin manages archived conversations, trash, storage inspection and GitHub updates. Read the [architecture](docs/architecture.md) for the module boundaries and [operations](docs/operations.md) for move, restore and deletion flows.

## Setup and checks

Use Node **24+** and the pnpm version pinned in `package.json`. DSH Desktop for macOS includes Node at `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node`; add its directory to `PATH` to use it.

```sh
node --version
pnpm install --frozen-lockfile
pnpm verify
pnpm pack --pack-destination artifacts
node scripts/release-artifacts.mjs artifacts
node --import tsx scripts/check-update-package.mjs artifacts
node scripts/verify-package-lifecycle.mjs artifacts
```

`verify` checks types, builds the bundles, and runs the unit, native integration, documentation and package checks. Regenerate `lib/` when changing source code. Run data tests with a temporary DSH home/profile and synthetic conversations.

## Native runtime

Native tests cover official DSH `0.2.1-rc.3`, `0.2.1-rc.5` and `0.2.2-rc.3`. On macOS they use the installed Desktop runtime by default. To choose another runtime, point to its directory containing `package.json` and `node_modules`:

```sh
DSH_TEST_VERSION=0.2.1-rc.5 DSH_RUNTIME_ROOT=/absolute/path/to/isolated-runtime pnpm test:integration
```

```powershell
$env:DSH_TEST_VERSION = '0.2.1-rc.5'
$env:DSH_RUNTIME_ROOT = 'C:\path\to\isolated-runtime'
pnpm test:integration
```

`node scripts/prepare-native-runtime.mjs` reuses an installed runtime for local tests. In CI, it can install the requested official version in a temporary directory. The integration suite exercises Cordis, JSONL, workspace registration, projections and native write locks.

The package lifecycle script installs the packed plugin in a temporary profile, checks bundle registration and API responses, then replaces the installation URL. It also uninstalls and reinstalls the plugin to check that trash is retained. URL tests use a local HTTP server.

## Host probe

From the source checkout, use Node 24+ to inspect an installed runtime:

```sh
node --import tsx scripts/probe-host.mts --runtime /absolute/path/to/installed-runtime
```

```powershell
node --import tsx scripts/probe-host.mts --runtime 'C:\path\to\installed-runtime'
```

```sh
ELECTRON_RUN_AS_NODE=1 \
  "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
  --expose-internals --import tsx scripts/probe-host.mts \
  --runtime "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh"
```

The final command uses the installed macOS Electron executable to read the ASAR archive. The probe uses the existing DSH installation, runs stock services in its own temporary directory, and removes that directory when done. It leaves user profiles untouched and creates no sessions, so session-owner checks remain untested. The JSON report contains the detected version, structural checks and counts.

Exit 0 means the version, platform, base capabilities and all global checks passed. Exit 1 means a check failed or the version/platform is outside the supported set; 2 means setup or cleanup failed. Untested global checks do not count as passes. CI saves a report for each host/platform combination; attach it with the reason code when reporting an issue.

## Regression coverage

| Change | Verify |
| --- | --- |
| File operations | Original bytes, host registration, interruption recovery and request replay |
| Relationships and idle release | Parent/subagent groups, retained forks, activity checks and complete native lifecycle release |
| Storage | Configured roots, file-type rules, exclusions, deduplication, limits, cancellation and changed files |
| Updates | Pinned release details, checksums, package validation, replacement in the current profile and installed/running versions |
| Interface | Visible selection, keyboard focus, confirmation expiry, late replies and per-item results |

When reporting an issue, include the plugin and DSH versions, operating system, action, result and a reproduction using synthetic data. The [verification record](docs/acceptance.md) lists the checks already run.

## Release

Publish the versioned `.tgz`, its `.tgz.sha256`, the default `.update.json` and every generated host-specific `.dsh-<host>.update.json` together on GitHub Releases. The metadata files point to the same package. The artifact generator validates the package contents. The checker verifies the checksum, metadata and update flow. The package contains the files listed in `files`, including the compiled host, client and Doctor bundles.

Give each release a new tag and asset URL. The updater accepts newer stable versions that explicitly support the running host. Keep verified packages in `updates/packages/`, where profile lockfiles may reference them. DSH's native manager handles installation in the current profile.

Before submitting a change, run the checks above and update the relevant documents in both languages. See the [usage guide](docs/installation.md) for installation and Doctor commands. Contributions are licensed under [Apache-2.0](LICENSE).
