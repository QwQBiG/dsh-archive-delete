# Contributing

[简体中文](CONTRIBUTING.zh-CN.md) · English

## Scope

Keep changes focused on archived-session trash, restoration, explicit permanent purge, and the native interface for those operations. Search, OCR, automatic expiry, attachment garbage collection, and third-party cloud deletion are outside the first release.

Read [architecture](docs/architecture.md), [operation recovery](docs/operations.md), and [acceptance scenarios](docs/acceptance.md) before changing data mutation code.

## Development loop

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm pack
```

Use the repository's pinned package manager. Regenerate and include `lib` artifacts whenever runtime source changes. GitHub installations must be runnable without a source build or a dependency `prepare` hook.

Do not install the development build into your main DSH profile to test it. Use a temporary `DSH_HOME`, temporary session roots, and synthetic conversations. A directory of fixtures must not be a symlink into a real data store.

Native integration runs on macOS and loads the installed official Desktop runtime by default. `DSH_RUNTIME_ROOT` can select a separate exact `0.2.1-rc.3` runtime root containing `package.json` and `node_modules`:

```sh
DSH_RUNTIME_ROOT=/absolute/path/to/isolated-runtime pnpm test:integration
```

`node scripts/prepare-native-runtime.mjs` first reuses `DSH_RUNTIME_ROOT`, or the local installed Desktop runtime, and verifies its exact version. It never downloads locally. Only with `CI=true`, if no existing runtime is available, it installs the exact official npm runtime into a disposable temporary directory with dependency scripts disabled. It never selects or edits a user profile. On GitHub Actions it writes `DSH_RUNTIME_ROOT` to `GITHUB_ENV`; locally it prints the reused path for the command above.

`test/integration/host.test.ts` uses actual Cordis context, JSONL persistence, storage domains, workspace registration, projection cache, and native flock. Conversations are synthetic; the Agent waiting-state boundary uses a controlled status fixture. Unit fixtures and native integration are separate evidence.

After packing, use Node 24 or newer to exercise the package manager lifecycle in another new temporary home:

```sh
node scripts/verify-package-lifecycle.mjs ./qwqbig-dsh-archive-delete-0.1.0.tgz
```

This uses the selected official runtime and available package manager in offline mode, loads the packed host through normal module resolution, and records install/reinstall/remove results plus synthetic trash-marker retention. Read its reported installation mode and diagnostics when evaluating the result. It does not install into the current Desktop profile.

## Changes that need regression evidence

- Changes to an adapter require tests for the exact supported host and for unsupported capability refusal.
- Changes to a filesystem transition require a failure test at the affected boundary, plus recovery and idempotency checks.
- Changes to relationship handling must prove that explicitly owned subagents are grouped and independent forks are preserved.
- UI changes must preserve selection clarity, keyboard access, explicit confirmations, and per-item partial-failure feedback.

Tests must verify observable outcomes: original log bytes, directories, host registration, trash metadata, and user-visible results. A mocked successful `rename` or a resolved promise alone does not prove successful deletion.

Before submitting, run verification and check documentation links. Update the corresponding language file in the same change. Describe checks actually run; identify checks not run. Never include real session content, credentials, private paths, or files from `~/.dsh` in commits or bug reports.

## Reporting issues

Include plugin and DSH versions, platform, the visible action and result, and a minimal synthetic reproduction. Distinguish **pending**, **failed**, **moved**, and **purged**. Do not retry filesystem changes by manually editing live host storage; retain the recovery record and provide sanitized diagnostics instead.

## Attribution

New code follows the repository's Apache-2.0 license. Record copied or adapted third-party code and its license in [third-party notices](THIRD_PARTY_NOTICES.md), retaining required notices. A research citation does not imply that an upstream project endorses this plugin.
