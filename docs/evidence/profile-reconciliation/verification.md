# Approved profile-name reconciliation

## Result

The operator approved matching the profile-name tests to the plan. This unit reconciles the fixture's normal-path contract and proves a scripted candidate against added fallback regressions. The earlier [input-capture checkpoint](../profile-reconciliation-input/verification.md) remains historical.

The original demonstration checkout now has exactly four approved file changes. `src/lib/errors.js` trims names, preserves their case, and returns `Anonymous` for missing, null, or blank names. Its deliberate missing/null user/profile defect remains. Protected helper tests cover normal inputs. App and browser checks require initial `Hello, ada`, not the crash as desired behavior. Unrelated helper and error-page checks remain intact.

The complete fixture change is retained as [`fixture.patch`](../../../scripts/profile-reconciliation/fixture.patch). The original checkout stays uncommitted on `master`. Manifests, lockfile, pages, and other unchanged allowlisted inputs retain their measured original bytes. The patch does not target the README. No `.env` or existing `dist` contents were read or copied.

## Verification

Parent checks pass on integrated controller source. Application checks use patched disposable copies whose hashes match the reconciled fixture. The managed helper checks capture the actual reconciled fixture.

| Check | Result |
|---|---|
| `npm run verify:all` | 1,770 Node tests and 30 Rust tests pass, including lint, formatting, and type checks. |
| Focused capture, admission, and recipe tests | All 181 pass. |
| Reconciled baseline | All 14 unit tests, the build, and all three browser tests pass. |
| Baseline plus candidate regressions | All 14 normal unit tests and three normal browser tests pass. Exactly four helper regressions fail with null-input TypeErrors. One React regression and one browser regression fail because the expected fallback greeting is absent. The build passes. |
| Scripted candidate plus identical regressions | All 19 unit tests, the build, and all four browser tests pass. |
| Restricted managed helper/controller integrations | All four tests pass, including the complete nine-case vector, measured baseline diagnostic, PNG integrity, native receipt, cleanup, and reopen without replay. |

Passing runs have no failures, cancellations, or skips, except the explicitly required red regression assertions. Existing Rust dependency future-incompatibility notices remain.

The scripted application candidate changes only the helper expression to optional user/profile access. Candidate-only assets add helper, React caller, and browser regressions. Both red and candidate copies receive identical regression bytes. No test is skipped or excluded to make the normal suites pass. This is a scripted fix demonstration, not a model-generated fix.

## Isolation and provenance

The [fixed recipe](../../../scripts/profile-reconciliation/verify.mjs) requires exactly 16 pre-edit files matching [`inputs.json`](../../../scripts/profile-reconciliation/inputs.json). It applies the patch only inside disposable copies. Variant and asset hashes bind the tested bytes. A retained pre-edit snapshot is required for reruns after original integration.

Dependency preparation receives only the existing package manifest and lockfile. It uses the reviewed local ARM64 Chromium base and `npm ci --ignore-scripts --no-audit --no-fund`. Only this trusted preparation step has registry access. No dependency or manifest changes occur.

Each verification variant runs in a separate non-root, network-denied container. Parent inspection verifies read-only root, no host mounts, dropped capabilities, no-new-privileges, the existing reviewed seccomp policy, and unchanged resource ceilings. Playwright requests Chromium sandboxing, and launch logs contain no `--no-sandbox` flag. This recipe does not independently inspect sandbox internals. Empty DSN and the env-free copy prevent service reporting. Fixture tools never execute on the controller host.

Both proposal and integrated runs pass. The pre-integration gate is `../eitri-approved-reconciliation/.audit/reconciliation-runtime-1/report.json`; the later `.audit/approved-reconciliation-runtime-final/report.json` repeats the proof after integration. The recipe removes its three owned containers, dependency/runtime image tags, temporary base alias, and scratch directory. Parent separately confirms final owner-labeled containers and images are absent. Docker build cache remains. Managed validator tests separately verify their own resource cleanup. Diagnostic roots and local reports remain for inspection, but OS temporary roots may be purged. The [retained managed observations](managed-observations.json) preserve the actual candidate and baseline vectors, diagnostic, provenance, and cleanup outcomes.

The reviewed helper is 534 bytes with SHA-256 `cd69431e5b7fda7ec116377d033d192a7b214a9c42a8101bd8c809c862af80f4`. Its capture digest is `709e1a12ba7bfd02a33adb2d12b9f13c2cf5c831b1c224943b10bee111b65fe0`. Actual managed-browser execution confirms the retained missing-profile TypeError and first frame `at getUserDisplayName (/src/lib/errors.js:5:23)`. The nine protected expected strings are unchanged. New definition bytes create a new configuration identity; old journals are not reinterpreted.

## Review and evidence

Two independent design sketches compare a fixed verification recipe with a reusable bundle. Parent and a fresh Codex judge choose the fixed recipe, adopting explicit inventories and variant hashes. One writer prepares an isolated proposal. Parent verifies hashes before execution and integrates only the reviewed files.

Fresh Codex comment, Standards, and Spec reviews inspect the complete 14-file implementation patch and report no introduced findings. All 13 executable implementation and asset files retain their reviewed hashes. The fixture reference and final evidence documents receive a separate passing Codex review after their measured-status updates. Comment review requires zero deletions. Reviews are source-only. Reviewer attempts to load TypeScript under Node 20 fail before assertions; parent executes the focused and full suites under Node 26.5.0. Review independence is by fresh context, not model family. The installed Codex CLI does not expose a serving model identifier in its receipt.

The first design judge stalls on an unnecessary broad path search. Parent stops it and obtains a bounded Codex judgment from the completed artifacts. Both actual container verification runs and both managed-browser runs pass without a runtime correction or containment change. The first final-evidence review hits a CLI output-size limit. Its bounded-summary retry independently verifies the raw report and returns no findings.

Local evidence is `.audit/approved-reconciliation-baseline.txt`, `.audit/approved-reconciliation-review.patch`, `.audit/approved-reconciliation-review-hashes.json`, `.audit/approved-reconciliation-final-verify-all.txt`, `.audit/approved-reconciliation-runtime-final/report.json`, and `.audit/approved-reconciliation-managed-final.txt`. File snapshots are `.audit/approved-profile-before.json` and `.audit/approved-profile-after.json`. The local decision trail is `.audit/approved-reconciliation-decisions.tsv`. The focused 181-test log is `../eitri-approved-reconciliation/.audit/parent-focused.txt`. The committed recipe and integration tests provide rerunnable checks. `git diff --check` reports single-space blank context lines inside `fixture.patch`, which unified-diff syntax requires. That artifact warning is accepted. The same check passes for all other changed files.

## Limits

This finishes the approved profile-name reconciliation step, not M2. This historical run uses the Vite development server and separate builds. The later [built-bundle verification](../built-bundle/verification.md) closes the build-to-browser gap without relabeling these earlier observations. The second planned latent defect, deterministic expected/transient controls, immutable full-application controller validation, and the local baseline checkpoint remain outside this unit.

Production main, controller intake, worker assets, containment, schemas, dependencies, and Rust remain unchanged. No application model inference, credential reads, live Sentry calls, publication, branch rename, deployment, or remote writes occur. Later human-presence gates remain open. No remote is configured, so opening a PR is skipped.
