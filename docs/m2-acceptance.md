# M2 acceptance evaluation

## Decision and boundary

**M2 accepted for its fixed-probe/scripted-patch/no-real-model contract.** The [plan's evaluation task](build-plan.md#current-m2-application-validation-slices) is complete. The matrix below and fresh checks demonstrate the stated M2 requirements at controller revision `fe745213444a62a6f695d84217d19a0356b58b8a`. No production dispatch or later integration is enabled by this verdict.

M2 calls for fixed probes and explicitly scripted patches, not a real model fix. The supported application executor admits only the exact reviewed installed baseline or one reviewed target patch. This finite contract does not authorize arbitrary generated Node programs, combined fixes, dependency changes or general command execution. Those still need separate review and verification.

## Requirement-to-evidence matrix

“Runtime” below means actual Git/SQLite, container or browser operations as identified; faux model turns and scripted external transcripts are not relabeled as live execution.

| M2 requirement | Demonstrated evidence | Qualification |
| --- | --- | --- |
| Pinned ARM64 worker and sandboxed, non-root Chromium | [Engine verification](evidence/validator-engine/verification.md); `test/integration/frozen-browser.test.ts` checks inspected settings, exact sandbox rows and kernel/CDP process witnesses. | Docker 29.8.2 ARM64, exact reviewed commit; pinned Node 26.5.0 / Playwright 1.64.1 base and dependency image. No engine/image fallback. |
| Denied host/home/sentinel/socket access and egress | [Standalone containment observations](evidence/chromium-containment-namespaces-chroot-pids256.json) record tested host paths and sentinel absence. Current validator requires no host mounts, checks absent `/host` and Docker socket, denied external connection and read-only root/snapshot. | Path probes establish those observations, not universal filesystem or kernel security. Current no-mount inspection and unchanged containment contract support composition with the earlier host-path checks. |
| Bounded execution resources and source/scratch | [Fixed execution contract and limits](frozen-browser.md#fixed-execution-contract): two CPUs, 4 GiB memory, 256 tasks, private IPC/shared memory and 256 MiB tmpfs; finite input, protocol and artifact bounds. | Supplied-context reservations are not a physical Docker disk quota. Preparation image, build cache and diagnostic roots remain retained; no global prune is permitted. |
| Safe brokered edits, durable checkpoint and cancellation | [Workspace checks](evidence/workspace/verification.json), [controller binding checks](evidence/controller-workspace/verification.md), `test/workspace-frozen-read.test.ts`, controller consumption/deadline tests, and actual running-container cancellation/watchdog tests. | Real Git reads drain on abort. An already admitted broker edit may finish at a safe boundary; pause prevents the next operation. Cancellation does not prove daemon-build cancellation. Lost builds remain uncertain and block new admission in that journal. |
| Immutable base/candidate validation | `test/integration/controller-application-check.test.ts` freezes managed source, edits through the broker, proves the prior selection unchanged, validates the later checkpoint and matches each real receipt/history/artifact to its revision. | Captured bytes are not falsely attributed to the original checkout's Git revision. Protected harness additions are configuration-bound, not application Git files. |
| Preserved fixture README/branch and local baseline | [Installed baseline verification](evidence/fixture-baseline/verification.md): local commit `103db4755657e9a1595120164242a7b9323defcd`, unchanged `master`, exactly 30 tracked paths, preserved README, excluded `.env`. | Source checkpoint only; no push, monitored-build activation or immutable deployed-release claim. |
| Green existing normal paths, two latent defects and deterministic controls | Installed recipe's unchanged baseline passes 30 unit and eight browser assertions; all five builds pass. Independent profile/cart red variants fail only designated target assertions; scripted candidates pass. Expected-validation and transient-upstream controls remain green. | The [baseline recipe](evidence/fixture-baseline/verification.md) is inherited runtime evidence, not a fresh run in this evaluation. Managed controller checks independently exercise both targets and controls with protected regressions. |
| Honest unit/build/browser observations and artifacts | [Application-check verification](evidence/fixture-application-check/verification.md) and exact-result admission cover command identities, exits, no skips/retries, unit witnesses, fresh build/preview response hashes, real receipts and PNG integrity across reopen without replay. | Unit/build/browser observations are bundled in a native baseline/browser receipt, not separate typed unit/build receipts. PNGs show the normal compiled view; target outcomes are assertions, not screenshot inference. Cases and edit checkpoints remain simulated. |
| No model, GitHub push or production activation | `src/main.ts` still configures only faux inference and synthetic issues, with no offline workspace/worker options. | No credential access, live API, publication, deployment or original-checkout edit belongs to this evaluation. |

## Verification in this evaluation

The [retained observations](evidence/m2-acceptance/observations.json) identify the tested source, log hashes, engine, fixture, case/revision/run IDs, outcomes, PNG hashes and post-run resource inspection.

| Command | Actual result |
| --- | --- |
| `npm run verify:all` | Exit 0; **1,837 Node and 30 Rust tests pass**. Lint, formatting and type/syntax checks pass. No failures, cancellations, skips or ignored Rust tests. Existing Rust dependency future-incompatibility notices remain. |
| Opt-in command below | Exit 0; **22 Docker integration tests pass**: complete synthetic validator suite plus both managed application targets. No failures, cancellations or skips. |

```sh
EITRI_FROZEN_DOCKER_ACCEPTANCE=1 \
EITRI_APPLICATION_FIXTURE_DIRECTORY=/canonical/path/to/eitri-test-web-app \
node --test --test-concurrency=1 \
  test/integration/frozen-browser.test.ts \
  test/integration/controller-application-check.test.ts
```

All four application builds pass. Profile baseline records exactly five designated unit failures and one target browser failure; cart baseline records exactly two designated unit failures and one target browser failure. Each candidate passes its complete unit suite and all nine browser assertions. Normal paths, controls, compiled-response proof and preview teardown pass throughout. Each case retains two real revision-bound receipts/PNGs across reopen without replay and one simulated checkpoint; each honestly parks at `assessment-required`. The fresh cart candidate PNG was directly viewed: it shows the normal `Hello, ada` application view, not the target's post-action result.

Preflight verifies all 17 source/test descriptors from the preceding reviewed implementation and both pinned local image IDs. The sibling remains clean on unchanged `master` at `103db4755657e9a1595120164242a7b9323defcd`; its 28-file capture digest is unchanged after the tests. Executable, test and dependency files have no diff. The repository has no emitted TypeScript build script: `npm run check` is its compilation gate; Rust Clippy/tests compile native targets. No behavior changes are made, so a new RED/GREEN test is not applicable to this documentation-only evaluation.

Read-only journal inspection finds 13 synthetic validator roots and 39 runs. The deliberate lost-build test retains one unknown build with **incomplete cleanup**, not a successful removal claim. Current owner-filtered container/image listings are empty for all 15 recorded owners, including the two application journals. That snapshot does not resolve the lost daemon response. Synthetic roots, the preparation image and build cache remain retained, with no global pruning or quota reset.

Local raw logs and extraction are under `.audit/m2-evaluation/`; the observations preserve their hashes and the unresolved run's retained directory. The first extraction attempt parsed a tool-truncated JSON preview and failed; bounded local-file extraction then succeeded. This was an evidence-extraction error, not a test failure. No failed runtime invocation or automatic retry is omitted from this evaluation.

## Limits that acceptance must not erase

- The outer Chromium census observes a collection window after the application harness, not every earlier application-browser process or every thread. Application Playwright configuration requests sandboxed Chromium; the shared container restrictions are independently inspected. No lifetime process attestation is claimed.
- Process-crash/reopen evidence is not power-loss durability, hostile same-UID protection or perpetual Docker daemon quiescence. Controller, worker and native publication remain separate commit boundaries and fail closed on uncertainty.
- The fixed-byte executor is not the future generated-code execution policy. Bundled receipts do not waive later phase/publication checks. Both examples deliberately park at `assessment-required`, without claiming a completed remediation.
- M3 credential/service setup, M4 supported sign-in and first inference, M5 publication/recovery acceptance, M6 deliberate live activation and optional M7 remain separate. Do not install services, read credentials, push, rename branches or activate a build as a consequence of checking an M2 task box.

## Review

A fresh-context independent reviewer checks correctness, readability, architecture, security and performance against the exact M2 contract. It finds no Critical or Important acceptance gap. Its Suggestion identifies an imprecise host-access citation: the matrix now links the raw report containing `hostHomeSentinel`/path observations rather than the summary without those fields. Author review also replaces obsolete current integration statements in the README, containment/workspace references and work-log checkpoint while preserving historical evidence. No source, permission or execution policy changes are needed.

The [review record](evidence/m2-acceptance/review.md) records independent review and final disposition. Independence is by fresh context, not cross-model-family assurance. M3 is the next stage, subject to its existing setup decisions and explicit human-presence gates; this task stops here.
