# Reference study and design decisions

[简体中文](research.zh-CN.md) · English

## Frozen baseline and method

Primary reference: [MichengAI/dsh-archive-manager](https://github.com/MichengAI/dsh-archive-manager/tree/6b8babc7b7f8da44466c7bd611ad29e66408623c), commit **`6b8babc7b7f8da44466c7bd611ad29e66408623c`**, package **1.1.18**, Apache-2.0. Its README's descriptive version still says 1.1.17; the package and changelog identify 1.1.18. The immutable commit, rather than a changing branch, is the research baseline.

The study inventories the complete `src`, `test`, and `scripts` trees, their contracts and named regression scenarios, and the README, changelog, manifest, loader patch, and build/release policy. The baseline contains 32 TypeScript source modules (10,232 lines), 43 JavaScript test/helper/fixture modules (9,272 lines), and nine scripts (614 lines), plus a TypeScript contract fixture. There are 320 statically named `test`/`it` declarations; parameterized execution can produce a different test count. These numbers describe coverage of the inventory, not passing test evidence.

Behavioral reading concentrates on persistence ownership, deletion order, subagent relationships, registration and cache writes, native UI lifecycle, authentication, and failure tests. This research is not an independent security audit, and upstream tests were not run as evidence for this new plugin. Our own implementation has its own [acceptance record](acceptance.md).

The installed official macOS DSH Desktop `0.2.1-rc.3` was also inspected. It provides native session-row extension slots and archive/unarchive operations, while session persistence has no public delete operation. Its JSONL writer uses a real session-directory lease; an idle UI state does not prove that the lease is free.

## Complete source map

Every source file at the frozen baseline belongs to the following groups:

| Group | Modules | What was learned |
| --- | --- | --- |
| Host entry and installation | `index.ts`, `host-install.ts`, `host-compat.ts` | One bundle installs UI and host behavior; exact host interfaces and unload restoration matter. The reference also includes updater and custom settings routes outside our scope. |
| Native workspace lifecycle | `workspace.ts`, `session-move.ts`, `projcache.ts` | Deletion, header/path indexes, workspace accounting, subagent cascade, spill cleanup, cross-workspace rewriting, and projection behavior are tightly related. |
| Shared and browser contracts | `contracts.ts`, `client-compat.ts`, `client-types.ts` | Wire shapes must be validated, and host-version differences should remain at a boundary. |
| Main interface and sidebar | `client.ts`, `sidebar-entry.ts`, `directory-flow-slot.ts` | Native slots, settings mounting, cleanup/disposal, sidebar navigation, menu augmentation, and third-party skin coexistence add considerable scope. |
| Archive navigation and organization | `archive-experience.ts`, `archive-organizer.ts`, `archive-organizer-ui.ts` | Current-session navigation, favorites, idle eligibility, serial batches, partial failure, and transient undo are separate product concerns. |
| Search and preview | `archive-discovery.ts`, `archive-discovery-ui.ts` | Read handles should close on both success and failure. The reference extracts only user/assistant text and scans batches rather than maintaining a persistent full-text index. |
| Cache repair | `cache-rebuild.ts`, `cache-rebuild-contract.ts`, `cache-rebuild-client.ts` | A deferred cache write is not durably confirmed until read back; timeout does not mean cancellation. Repair writes must remain ordered against deletion. |
| Settings and updates | `plugin-settings.ts`, `plugin-updater.ts`, `plugin-update-model.ts`, `plugin-update-ui.ts`, `release-age.ts` | Local settings writes, profile-aware package installation, release-age policy, update UI state, and restart ownership are a product in themselves. We delegate updates to DSH instead. |
| UI primitives and host shims | `plugin-ui.ts`, `host-react-shim.ts`, `host-react-dom-shim.ts`, `host-jsx-shim.ts` | Host React reuse avoids a second React runtime; native controls, portal placement, focus handling, and localization are important. |
| API base and system explorer | `api-base.ts`, `explorer-path-policy.ts`, `native-explorer.ts` | Resolve requests against the document base and validate paths against host ownership. Opening system folders is unrelated to our narrow lifecycle. |

Reference source: [the complete source tree](https://github.com/MichengAI/dsh-archive-manager/tree/6b8babc7b7f8da44466c7bd611ad29e66408623c/src).

The lifecycle functions that informed this design are mapped explicitly below. These names describe the reference, not a promise that this project exposes the same API.

| Reference interface/function | Observed behavior | Decision here |
| --- | --- | --- |
| `installArchiveWorkspace`, `bindArchiveManagerRemote` | Extend the existing registry and register remote descriptors, with unload cleanup | Keep host coupling inside an adapter; use a small authenticated action endpoint |
| `archivedSessionMetadata`, `pruneUnknownArchivedSessionIds`, `sessionArtifactMissing` | Metadata reads may prune proven missing artifacts and their markers | Read-only listing; preserve a failed read as an error |
| `deleteArchivedSessions`, `deleteSessionCore` | Serialize deletion batches; live-session/cache/bookkeeping and disk removal have separate failure points | Preview complete groups, then journal reversible moves and report each target |
| `jsonlSessionDirectory`, `removeTranscriptDirectory` | Prove directory ownership before removing all log generations | Admit only the verified official layout; move the directory on the same volume |
| `deleteDescendants`, `cleanSpill` | Cascade explicit subagents, log child errors, clean spill | Whole-group preflight and recovery; retain spill |
| `moveSessionToWorkspace`, session-move helpers | Rewrite workspace association and derived metadata | Restore original association only; do not add general workspace migration |
| Cache-rebuild readback helpers | Distinguish requested asynchronous writes from observed persisted records | Keep registration failure visible; require recovery rather than guessing success |

## Historical issues and evidence limits

Public issue reports were read as primary reports, not reproduced failures in this plugin. The following status reflects the study on 2026-10-28; source conclusions are tied to the frozen commit.

| Report | Reported problem and lesson |
| --- | --- |
| [#88](https://github.com/MichengAI/dsh-archive-manager/issues/88), closed | Removing legacy-cache handoff could leave cold conversations without official titles. A surviving log and a complete native projection are different conditions; do not introduce another title mirror. |
| [#90](https://github.com/MichengAI/dsh-archive-manager/issues/90), closed | Inserting a sidebar star changed child indexes used by another skin. Prefer supported slots and avoid positional DOM assumptions. |
| [#92](https://github.com/MichengAI/dsh-archive-manager/issues/92), closed | A favorite star obscured the host's activity indicator. A plugin's decoration must preserve host activity visibility. |
| [#94](https://github.com/MichengAI/dsh-archive-manager/issues/94), open | A reporter found old v2 mirror entries after session deletion. State the deletion boundary precisely and clear this plugin's own recovery titles on purge. |
| [#95](https://github.com/MichengAI/dsh-archive-manager/issues/95), open | A reporter questioned plaintext first-message retention in the old mirror. Avoid first-message copies and disclose retained shared/third-party data. |

The reports contain user-supplied measurements and suggested fixes. This study does not turn those measurements into independently verified facts or authorize cleaning another plugin's files.

## Host and data-flow findings

### 1. Archive is not deletion

Archive is a host-owned set membership change; it retains the physical log. DSH's native archive operation has activity checking and stop-and-archive behavior. Our plugin uses an already archived parent as a precondition and does not duplicate or bypass that workflow.

The reference extends the existing `WorkspaceRegistry` instance, installs additional methods, and contributes Typert Remote descriptors. Its compatibility types expose internal fields such as header/path maps and registry queues. Our adapter must own any equivalent coupling; domain/service code must not reach those shapes directly.

### 2. Absence must be proven

The reference's `sessionArtifactMissing` explains that `persistence.stat(id)` can return no header for a corrupt or empty artifact. That is not proof that the directory is absent. Its checks combine physical lookup and directory evidence before pruning orphan references.

Our list and preview are read-only. They must not prune a native archive marker merely because a header read failed. Errors remain visible and retryable.

### 3. A generic located file does not grant directory ownership

The reference's `jsonlSessionDirectory` verifies the official backend, canonical root, encoded session ID, project-key derivation, and generation filename before treating a parent directory as session-owned. It also checks project/session symlinks. When layout ownership cannot be proved, the reference falls back to deleting only an artifact.

Our supported-backend gate instead refuses an unprovable group. We must preserve all log generations together; deleting only the newest generation can reveal an older generation as if the session still existed.

### 4. Forks and subagents need different treatment

Both can refer to a parent, so `parentSession` alone is insufficient. The reference cascades only through explicit `origin: "subagent"` relationships and preserves independent forks.

The reference logs child-deletion failures and continues deleting the parent. It documents that this cascade is not transactional. Our recoverable move preflights the whole group and records each moved member so an incomplete group remains recoverable. Tests must verify fork readability, not just its surviving directory.

### 5. Host retention and filesystem leases are different from activity

The reference flushes and detaches live sessions during permanent deletion; it also contains a cold-session notification path. Our approved behavior deliberately avoids forced detach: an idle session retained by the current host becomes pending, while active work or external ownership blocks it.

The pending request must bind the observed content and archive state. Its later execution rechecks state and lease ownership instead of treating a previous confirmation as perpetual authority over changed data.

### 6. Derived storage should not become a second source of truth

The reference's historic v2 projection mirror left legacy records with titles and user-first-message text. Reports [#94](https://github.com/MichengAI/dsh-archive-manager/issues/94) and [#95](https://github.com/MichengAI/dsh-archive-manager/issues/95) concern that migration residue. The frozen current version no longer reads or generates that old mirror; it does not automatically erase old third-party cache directories.

Our plugin stores recovery metadata only while recovery needs it, does not mirror first-message text, and does not silently sweep another plugin's history. Purge removes its own associated metadata. Shared attachments and spill are explicitly retained.

### 7. Native integration has a smaller stable surface than sidebar replacement

The reference has a full sidebar/browser experience and DOM-assisted menu/skin coexistence logic. Its changelog records regressions involving status dots, star alignment, settings IDs, and modal placement. Those are real maintenance obligations, not evidence that the entire reference is poorly engineered.

Our UI uses only the archived-row menu slot, plugin details slot, and a compact native dialog. We do not clone the sidebar, inject into DOM child positions, or add favorites, a custom calendar, explorer actions, and a plugin updater.

## Test and release study

The 36 top-level test suites cover host lifecycle, UI composition, discovery, organizer behavior, workspace movement, updates/settings, disabled-plugin restoration, type/build/package constraints, and regressions for issues 88/90/92. Helpers/fixtures construct isolated real hosts, gateway peers, client stores, and synthetic projection/session data.

Particularly useful cases in `host.test.mjs` prove encoded-ID handling, initialized-root use after cwd changes, parent-directory preservation, symbolic-link refusal, retaining retryable bookkeeping after physical failure, cold subagent enumeration, and preserving forks. Composition/UI tests cover confirmations, duplicate submission, batch results, unload restoration, remote binding, and settings placement.

The nine release/build scripts have these roles:

| Script | Role and decision for this project |
| --- | --- |
| `build.mjs` | Builds in staging, reuses host React, includes bundled notices, then publishes runnable `lib`. Retain the generated-artifact principle. |
| `check-generated.mjs` | Requires committed `lib` and no dependency `prepare` build. Retain this GitHub installation boundary. |
| `check-package.mjs` | Checks package completeness. Use a smaller scope-specific list. |
| `test-version-matrix.mjs` | Installs exact isolated host generations and checks for mixed versions. Start with one actually verified version. |
| `test-latest-compatibility.mjs` | Builds a fresh exact host environment. Keep independent host integration evidence. |
| `host-test-dependencies.mjs` | Pins transitive host packages for compatibility tests. Avoid accidental mixed core generations. |
| `release-control.mjs` | Reconciles npm exact version/git head and GitHub release. Not needed before an npm distribution exists. |
| `extract-release-notes.mjs` | Requires both English and Chinese changelog entries. Retain paired release documentation. |
| `release-preflight.ps1` | Runs frozen install and verification under the release policy. Use platform-appropriate repeatable preflight. |

## Decisions retained and changed

Retain: host-provided React, TypeScript strictness, shared validated contracts, centralized compatibility handling, serial batch mutations, per-item failure reporting, generated GitHub artifacts, bilingual documentation, and synthetic integration fixtures.

Change: archive-only scope; a recoverable trash rather than immediate permanent deletion; no forced live-session detach; explicit pending requests; read-only list/preview; journaled whole-group filesystem transitions; no second projection mirror; no sidebar replacement, custom updater, cache repair, automatic cleanup, or shared-resource deletion.

These differences do not establish market novelty. The goal here is a narrow implementation whose consistency and native user flow can be demonstrated by its own tests.
