# Built-bundle browser validation

## Result

Source `36144ee4ca88ea20ac897f02fc00902d5bc74b97` completes the next bounded fixture step. Operators can rerun the existing profile-name recipe against freshly built application assets. Maintainers inherit one preview-backed path and explicit output/response identities, not another server implementation or execution mode.

The [retained observations](observations.json) contain build manifests, actual browser response identities, expected regression failures, negative-control diagnostics and resource-removal records. The earlier [reconciliation result](../profile-reconciliation/verification.md) remains historical development-server evidence.

| Variant | Unit assertions | Built-browser specs |
|---|---|---|
| Baseline | 14 pass. | Four pass, including provenance. |
| Baseline with regressions | 14 pass. Exactly four helper fallback cases and one React greeting case fail. | Four pass. Only the literal `Hello, Anonymous` regression fails. |
| Scripted candidate with identical regressions | All 19 pass. | All five pass. |

Every variant builds successfully before browser startup. Provenance passes in every variant. No tests are skipped or retried. Preview is no longer listening after each browser command, including the expected-red command. The candidate is the existing disposable optional-access patch, not a model-generated repair.

## Proof and controls

The verification overlay replaces the inherited development server with one strict loopback Vite preview server. It disallows server reuse and blocks service workers. A dedicated browser test compares actual navigation HTML and loaded compiled-entry JavaScript with the fresh build's sizes and SHA-256 hashes. It also validates any observed executable or stylesheet response. The manifest and proof remain outside disposable `dist`.

Actual contained controls reject all four substitutions.

| Control | Observed rejection |
|---|---|
| Development server on the same origin | Source/development request rejection after the greeting check. |
| Same-size JavaScript mutation after inventory | The loaded response's SHA-256 differs from the manifest. |
| Missing `dist` | Preview readiness times out. There is no development-server fallback. |
| Failed Vite build | The runner records only unit/build commands and blocks before browser startup. |

These controls run in instrumented disposable recipe copies. They do not add production switches or modify original fixture files. The final control run also repeats all three normal variants successfully. The committed subprocess tests separately exercise missing, malformed, oversized and mismatched proof, invalid output inventories, skipped/retried/renamed results, unexpected red failures, service-worker responses and altered response bodies. Those tests use doubles for external tools and browser events.

`npm run verify:all` passes 1,777 Node tests and 30 Rust tests, including lint, formatting and type checks. Parent runs all nine focused recipe tests before runtime validation and again after integration. The final integrated full-suite receipt explicitly records source revision `36144ee` and a clean executable/test diff before execution. Existing Rust dependency future-incompatibility notices remain. Passing suites have no failures, cancellations, skips or ignored Rust tests.

An earlier metadata-stamped integrated run fails the unchanged `trusted check output rejects case-count without accepting evidence` test at its existing five-second settling deadline. Its raw log remains `.audit/built-bundle-integrated-verify-all.txt`. Three isolated reproductions pass, then one unchanged full-suite retry passes. Timing sensitivity is inferred; the historical cause is unproved. No artifact test or controller behavior is changed to obtain the passing retry.

## Isolation and rerun

The recipe still admits only the same 16 exact pre-edit files and applies the approved patch in disposable copies. Parent uses the retained `.audit/approved-profile-fixture-original` snapshot. All 16 tested baseline inputs match the reconciled sibling. A separate invocation rejects that already-reconciled sibling before output-directory creation. The sibling's 16 allowlisted file bytes, inodes and modification times remain unchanged throughout this step. No original `.env` or existing `dist` is read or copied.

Dependency preparation alone retains registry access with the existing locked manifests and `npm ci --ignore-scripts`. Runtime builds and browser variants remain offline in separate non-root containers. The existing base, seccomp policy, no mounts, read-only root, dropped capabilities, no-new-privileges and resource ceilings remain unchanged. The recipe requests Chromium sandboxing and rejects `--no-sandbox`; it does not independently inspect sandbox internals.

Rerun from the repository root with the existing recipe.

```sh
node scripts/profile-reconciliation/verify.mjs \
  /absolute/path/to/retained-preedit-snapshot \
  /absolute/path/to/new-evidence-directory
```

The source snapshot must match `inputs.json`. The output directory must not exist. The reviewed local ARM64 base and `orbstack` context remain prerequisites. Fixture tools run only inside the containers.

Both final runs remove their owned containers, dependency/runtime image tags, temporary base alias and scratch. Parent independently queries the owner-filtered container/image listings and alias names and finds none. Docker build cache and local reports remain. Cleanup is not a physical disk-reclamation claim.

## Design and review

| Design | Decision |
|---|---|
| Vite preview with actual response-byte proof | Selected. Reuses existing server lifecycle and command interface. |
| Custom artifact-only HTTP child and IPC | Rejected. Adds routing, MIME and lifecycle policy without a needed caller. |

The selected design adopts `forbidOnly`, expected-status validation, bounded proof records and negative checks from the alternative. One isolated writer owns the coupled recipe change. Fresh Codex Standards and Spec reviews of the complete frozen patch report zero findings. The separate comment audit identifies one redundant test comment, which parent deletes. Parent verifies and fast-forwards the source locally. Review independence is by fresh context within `openai-codex/gpt-6.1-sol`, not by model family. A final fresh Codex delta/evidence review reports no issues and explicitly does not rerun tests or recompute hashes. A separate `anthropic/claude-opus-5-5` trail audit finds no material contradiction. Its missing trail pointers are added locally, and the integrated suite is repeated with revision metadata. Cross-family assurance remains an evidence audit, not another runtime execution.

Two initial child artifacts fail output validation. Parent recovers the complete designs from this workspace's transcripts, then obtains a fresh complete comparison. The earlier one-candidate assessment is not counted as comparative acceptance. The first negative-control instrument fails JavaScript parsing before fixture execution. A corrected instrument then selects no tests because its anchored filter excludes Playwright's full titles. Parent fixes the instrument, obtains passing controls, and repeats with a same-size mutation to exercise the SHA-256 check specifically. Neither failed instrument is counted as runtime proof. All owned resources from those runs are removed.

Raw local evidence is `.audit/built-bundle-runtime/report.json`, `.audit/built-bundle-controls-runtime-4/report.json`, `.audit/built-bundle-final-verify-all.txt`, `.audit/built-bundle-integrated-verify-all-retry.txt`, `.audit/built-bundle-artifact-timeout-reproduction.txt`, `.audit/built-bundle-integrated-focused.txt`, `.audit/built-bundle-preimage-rejection.txt` and `.audit/built-bundle-fixture-{before,after}.json`. The local control producer is `.audit/prepare-built-bundle-controls.mjs`; `.audit/record-built-bundle-evidence.mjs` checks raw results and produces the retained observations. These local paths are not portable prerequisites for the normal recipe.

## Limits

The dedicated provenance navigation attests its own loaded HTML and JavaScript, not every request in the other browser scenarios. Source maps are inventoried but need not load. This fixture emits no stylesheet, so actual CSS proof remains covered by synthetic tests rather than this Docker run.

This finishes built-bundle browser validation, not M2. The second latent defect, deterministic expected/transient controls, immutable full-application controller validation and local fixture baseline commit remain open. Production activation and later human-presence gates remain closed. No production entrypoint, controller intake, worker asset, containment rule, dependency, Rust source or original fixture changes. No credential read, live service call, application inference, publication, deployment, branch rename or remote write occurs. No remote is configured, so PR creation is skipped.
