# Contributing

[简体中文](CONTRIBUTING.zh-CN.md) · English

The project covers archived-session trash, restoration, permanent deletion, storage inspection and GitHub updates. Start with the [architecture](docs/architecture.md) and [operation flows](docs/operations.md).

## Setup and checks

Use Node **24+** and the pinned pnpm version. macOS Desktop includes a Node executable at `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node`; its directory can be added to `PATH`.

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm pack --pack-destination artifacts
node scripts/release-artifacts.mjs artifacts
node --import tsx scripts/check-update-package.mjs artifacts
node scripts/verify-package-lifecycle.mjs ./artifacts/qwqbig-dsh-archive-delete-0.0.2.tgz
```

`verify` runs type/build, unit, native integration, documentation and package checks. Source changes include regenerated `lib/` files. Use a temporary home/profile and synthetic conversations for data tests.

## Native runtime

Tests target official DSH `0.2.1-rc.3` / `0.2.1-rc.5`. macOS uses the installed Desktop runtime by default. To select a runtime containing `package.json` and `node_modules`:

```sh
DSH_TEST_VERSION=0.2.1-rc.5 DSH_RUNTIME_ROOT=/absolute/path/to/isolated-runtime pnpm test:integration
```

```powershell
$env:DSH_TEST_VERSION = '0.2.1-rc.5'
$env:DSH_RUNTIME_ROOT = 'C:\path\to\isolated-runtime'
pnpm test:integration
```

`node scripts/prepare-native-runtime.mjs` reuses an existing runtime locally. In CI it can prepare the exact official runtime in a temporary directory. The integration suite exercises Cordis, JSONL, workspace registration, projections and native leases.

The package lifecycle script installs the packed plugin in a temporary profile, checks bundle registration and the responding API, replaces its source URL, and exercises uninstall/reinstall with retained trash. Its URL fixtures run on local HTTP.

## Regression coverage

| Change | Verify |
| --- | --- |
| File transitions | Original bytes, host registration, interruption recovery and request replay |
| Relationships and idle release | Parent/subagent grouping, fork retention, activity checks and complete native teardown |
| Storage | Configured roots, file-type rules, exclusions, deduplication, limits, cancellation and changed files |
| Updates | Release pins, checksums, package admission, current-profile replacement and installed/running state |
| Interface | Visible selection, keyboard focus, confirmation expiry, late replies and per-item results |

Keep test data independent of real history. Issue reports should include plugin/host versions, OS, action, result and a synthetic reproduction. See the [verification record](docs/acceptance.md).

## Release

Publish the versioned `.tgz`, its `.tgz.sha256`, the default `.update.json` and the `.dsh-0.2.1-rc.5.update.json` together on GitHub Releases. Both metadata files select the same package. The artifact generator validates package contents; the checker verifies the checksum, metadata and updater flow. The package includes compiled host/client/Doctor files from the `files` allowlist.

Each release gets a new tag and asset URL. The updater accepts newer stable versions for the exact supported host. Verified packages remain in `updates/packages/` because profile lockfiles can reference them. Installation uses the profile's native DSH manager.

Run the commands above and update relevant documentation and its corresponding language file in the same change. Installation and Doctor commands are in the [usage guide](docs/installation.md). Contributions use [Apache-2.0](LICENSE).
