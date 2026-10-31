# Contributing

[简体中文](CONTRIBUTING.zh-CN.md) · English

## Scope

Keep changes focused on archived-session trash, restoration, explicit permanent purge, the native interface, read-only storage inspection, and confirmed GitHub updates through the current profile's native plugin manager. Search, OCR, automatic expiry, attachment garbage collection, project-file deletion, and third-party cloud deletion are outside this scope.

Read [architecture](docs/architecture.md), [operation recovery](docs/operations.md), and [acceptance scenarios](docs/acceptance.md) before changing data mutation code.

## Development loop

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm pack --pack-destination artifacts
node scripts/release-artifacts.mjs artifacts
node --import tsx scripts/check-update-package.mjs artifacts
```

Use Node **24 or newer** and the repository's pinned package manager. A system Node 22 is too old even if Desktop itself runs a bundled Node 24. The macOS Desktop installation may include a real executable at `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node`; select that executable's directory in `PATH`, or install Node 24+ separately on either platform. Do not invoke `runtime/bin/node` as a standalone executable unless its required Desktop environment is present: it can be an Electron wrapper relying on `DSH_DESKTOP_NODE_EXECUTABLE`. End users installing the precompiled plugin do not need this build setup. Regenerate and include `lib` artifacts whenever runtime source changes. GitHub installations must be runnable without a source build or a dependency `prepare` hook.

Do not install the development build into your main DSH profile to test it. Use a temporary `DSH_HOME`, temporary session roots, and synthetic conversations. A directory of fixtures must not be a symlink into a real data store.

Native integration is verified on macOS and Windows CI for the exact supported host. macOS loads the installed official Desktop runtime by default; set `DSH_RUNTIME_ROOT` on Windows or to select another exact `0.2.1-rc.3` runtime root containing `package.json` and `node_modules`. In a POSIX shell:

```sh
DSH_RUNTIME_ROOT=/absolute/path/to/isolated-runtime pnpm test:integration
```

In PowerShell:

```powershell
$env:DSH_RUNTIME_ROOT = 'C:\path\to\isolated-runtime'
pnpm test:integration
```

`node scripts/prepare-native-runtime.mjs` first reuses `DSH_RUNTIME_ROOT`, or the local installed Desktop runtime, and verifies its exact version. It never downloads locally. Only with `CI=true`, if no existing runtime is available, it installs the exact official npm runtime into a disposable temporary directory with dependency scripts disabled. It never selects or edits a user profile. On GitHub Actions it writes `DSH_RUNTIME_ROOT` to `GITHUB_ENV`; locally it prints the reused path for the command above.

`test/integration/host.test.ts` uses actual Cordis context, JSONL persistence, storage domains, workspace registration, projection cache, and host-compatible native leases. Conversations are synthetic; the Agent waiting-state boundary uses a controlled status fixture. Unit fixtures, native integration, and Desktop GUI checks are separate evidence.

After packing, use Node 24 or newer to exercise the package manager lifecycle in another new temporary home:

```sh
node scripts/verify-package-lifecycle.mjs ./artifacts/qwqbig-dsh-archive-delete-0.0.2.tgz
```

This reuses the selected official runtime and available package manager. Package install/reinstall/remove checks use offline cache; a separate fixed-URL upgrade fixture serves tarballs on local HTTP without contacting GitHub or a public registry. It loads the packed host through normal module resolution and checks synthetic trash retention. The manager registers bundles; CLI activation behavior depends on the host build and invocation mode. An installation-only invocation can leave bundle registration absent; verify the manifest instead of treating dependency presence as activation. Keep these installation paths separate in tests and reports, and follow the [CLI registration instructions](docs/installation.md) for manual CLI use. Read the reported installation mode and diagnostics when evaluating the result. It does not install into the current Desktop profile.

## Release package and diagnostics

Distribute the generated `.tgz` as a versioned GitHub Release asset, alongside its SHA-256 checksum and `.update.json` metadata. Distribution remains on GitHub; no npm publication is needed. The primary user-facing address must point to that package rather than a repository archive. Check the packed file list against the package allowlist, including the host, browser and doctor artifacts. Exclude source, tests, lockfiles and CI files. A new version gets a new URL; do not replace published assets or retarget a published tag.

```sh
pnpm pack --pack-destination artifacts
node scripts/release-artifacts.mjs artifacts
node --import tsx scripts/check-update-package.mjs artifacts
```

The artifact script writes a `.tgz.sha256` checksum and generates the matching `.update.json` from the actual package bytes. Metadata declares the fixed package name, stable package version, exact required DSH version, supported platforms, and package name/byte count/SHA-256. All three assets belong to the same tagged release. `check-update-package.mjs` must pass for local packs and in CI after metadata generation and before lifecycle installation; it exercises the real source's discovery, pin, checksum and archive admission with local response fixtures. The updater reads release metadata automatically and downloads the `.tgz` only after explicit confirmation. Metadata or archive admission alone is not proof that a package will activate.

Updater tests must use synthetic releases, controlled HTTP responses, and isolated native-manager profiles. Reuse the installed DSH runtime; do not exercise update installation against a real profile or contact GitHub from unit tests. Cover stable-version/host/platform selection, response and archive limits, redirects, changed release pins, checksums, unsafe tar entries, install hooks/dependencies, cache timing, same-request retries, and archive-queue draining. Native integration must prove replacement of only the current profile's same-named bundle, exact retained package references, and correct installed-versus-running version reporting. A native rejection test verifies manifest/lockfile rollback; this does not establish complete rollback after arbitrary activation or hot-reload failures.

Verified packages stay under `<DSH_HOME>/archive-delete/updates/packages/` because the profile's `file:` dependency and lockfile can reference them. Keep these shared package files for reproducible reinstalls; do not add automatic package cleanup while references may exist. Check and installation records are isolated per profile as `updates/<profile-hash>.check.json` and `updates/<profile-hash>.installation.json`, using the SHA-256 of the server-owned canonical profile directory; they remain independent of session recovery receipts. Disposal must cancel update checks without awaiting a native installation that is already replacing this plugin: the native manager can be waiting for that same disposal.

Use the [doctor instructions](docs/installation.md) with the same isolated home/profile used by the test host. The doctor must remain read-only, report warnings for prerequisites it cannot establish, and never equate a configuration dump or stored directory with a running plugin. Changes to startup logging must prove that failed recovery or API registration cannot print a loaded signal. Package lifecycle checks must cover an explicit new dependency source, registration without duplicates, uninstall bundle cleanup, and retained trash.

## Changes that need regression evidence

- Changes to an adapter require tests for the exact supported host and for unsupported capability refusal. Native idle-release changes must prove complete lifecycle teardown, empty-input/idle admission, outside-group runtime-child protection, and revalidation after teardown before any move. A scope-only disposal or manual registry deletion is not full writer ownership release.
- Changes to a filesystem transition require a failure test at the affected boundary, plus recovery and idempotency checks.
- Changes to relationship handling must prove that explicitly owned subagents are grouped and independent forks are preserved.
- Storage scans must stay manual, bounded and metadata-only. Test configured roots outside the data home, exclusions, global path/hard-link deduplication, unknown locations, cancellation, file changes and partial results. Workspace tests must use registered IDs, recheck membership/path and preserve all fixture bytes; no scan result can become cleanup authority or an AI-origin classification.
- Trash size/fingerprint changes need same-observation drift checks, current remaining sizes after a partial purge and held-lease confirmation checks. Do not infer freed physical space from logical bytes or automatically discard idempotency receipts.
- Update changes must preserve explicit confirmation, fresh server-owned pin validation, current-profile native-manager admission and an independent installation journal. Failed discovery must not report a version as current; an uncertain installation must retain its request ID and block a new upgrade until reconciled. Do not promise installation without a restart or complete activation rollback.
- UI changes must preserve selection clarity, keyboard access, explicit confirmations, and per-item partial-failure feedback. Pending retry must cancel the old request, require a fresh preview/confirmation, preserve uncertainty handling, and never reopen a dialog closed during cancellation.

Tests must verify observable outcomes: original log bytes, directories, host registration, trash metadata, and user-visible results. A mocked successful `rename` or a resolved promise alone does not prove successful deletion.

Before submitting, run verification and check documentation links. Update the corresponding language file in the same change. Describe checks actually run; identify checks not run. Never include real session content, credentials, private paths, or files from `~/.dsh` in commits or bug reports.

## Reporting issues

Include plugin and DSH versions, platform, the visible action and result, and a minimal synthetic reproduction. Distinguish **pending**, **failed**, **moved**, and **purged**. Do not retry filesystem changes by manually editing live host storage; retain the recovery record and provide sanitized diagnostics instead.

## Attribution

Contributions are licensed under [Apache-2.0](LICENSE).
