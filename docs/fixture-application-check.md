# Protected application checks through the controller

The opt-in offline scenarios `fixture-profile-v1` and `fixture-cart-v1` run the installed demonstration application from a managed frozen revision. Production `src/main.ts` does not select these scenarios or enable execution. This is scripted M2 validation, not a model-generated repair or full M2 acceptance.

## Input and dependency policy

Use [`captureFixtureApplicationInput`](fixture-application-input.md) to acquire the 28 inputs, then supply them as the offline controller baseline. The validator independently requires the exact [`installed-inputs.json`](../scripts/profile-reconciliation/installed-inputs.json) descriptors. For the selected target only, it also accepts the exact reviewed one-line scripted candidate. Every other source, test, manifest and configuration must remain byte-identical. Missing, additional, duplicate or modified paths fail before Docker calls. Acquisition alone does not grant execution authority.

This deliberately **does not admit arbitrary generated Node code**, new tests, combined patches or changes to the expected-validation/transient controls. A broader candidate policy requires a separate design/security review. The original demonstration checkout, `.env`, dependencies and Git metadata are not mounted or changed.

The preparation image `eitri-application-dependencies:v1` is pinned to `sha256:cde9827f782cbcd81a74ccefa4c5fef521546724c83ca7da2da8dcdc5c408a5f`. It contains dependencies installed from the reviewed fixture lockfile with `npm ci --ignore-scripts --no-audit --no-fund`, on the existing pinned ARM64 Chromium base. Preparation is a separate network-enabled dependency build, not an admitted check:

```sh
node scripts/profile-reconciliation/prepare-application.mjs \
  /canonical/path/to/eitri-test-web-app /canonical/new/build-directory
```

The command requires a fresh output directory, refuses to replace an existing preparation tag, and copies only the reviewed package/lock manifests into its context. A rebuilt image may have a different ID: inspect and review it rather than silently changing the validator pin. The preparation image and build cache are retained; per-run cleanup does not delete them or globally prune Docker.

Each admitted check inspects the dependency image ID before and after its offline COPY build. The existing image/configuration, engine, resource, network, process, filesystem, deadline and owned-resource checks remain enforced. No package installation occurs during validation. A missing/mismatched image is an infrastructure failure, not a fallback to network installation. Journals bind the new worker/harness bytes and dependency pin in their configuration digest. Use fresh journals for this configuration; older configurations are not silently migrated or adopted.

## Execution and observations

Trusted offline configuration selects `workerScenarioId` and enables the existing acceptance/consumption callbacks. The controller retains the request, action/epoch, exact frozen revision, configuration and live admission facts. The same consumed-run admission path creates native real baseline/browser receipts and case-scoped PNG artifacts.

Inside the unchanged containment envelope, the driver verifies the snapshot and copies it into disposable `/tmp/work`. It adds the protected target regression tests and browser-proof configuration from the controller-owned harness, not from caller inputs. Original normal-path tests remain present. The harness and regressions are hashed in validator configuration; they are not falsely described as application Git files.

The protected recipe executes:

1. The complete unit suite, with no retries, plus the unit witness for hidden retries/repeats/expected failures and unhandled/module errors.
2. A fresh production build, followed by a bounded inventory of built bytes.
3. Nine real Chromium browser assertions against strict loopback Vite preview, including normal paths, target regressions, both deterministic controls and compiled-response SHA-256 proof. The preview must stop afterward.

A small trusted Python supervisor uses the kernel's unprivileged child-subreaper facility and `waitpid` to reap orphaned application/browser descendants while the harness runs. This prevents process accumulation from consuming the unchanged 256-task ceiling; it adds no capability, seccomp exception, init service or dependency. It preserves the main harness's exit and waits for adopted descendants before the outer containment witness.

The child receives a fixed minimal environment, including `/ms-playwright` browser assets. It receives no controller capability, protocol nonce, request binding, service credential or ambient host environment. Its subprocess has a 55-second timeout and a 192 KiB output ceiling, inside the existing controller action/worker deadlines. Errors, overflow, cancellation, invalid results or incomplete cleanup cannot yield passing receipts. There is no automatic retry.

The host revalidates exact test identities/statuses, diagnostics, command exits, no skips/retries, witness records, preview teardown and built-response provenance rather than trusting `verdict: passed`. The red variant must fail only the selected target's designated assertions. The reviewed patch must pass all assertions. Request role and measured results determine baseline-reproduced/not-reproduced or candidate-passed/failed; unrelated failures cannot stand in for a target reproduction.

The native **browser receipt contains the bundled unit/build/browser observations** in retained execution history. This does not invent separate native unit/regression/build receipts or waive the controller's later phase/publication requirements. The scripted edit checkpoint remains explicitly simulated. The PNG shows the actual normal `/render-error` application view from the compiled-response proof; target-specific outcomes are in the protected assertion records, not inferred from that screenshot. The separate outer Chromium census witnesses the common containment configuration, not each earlier application-browser process.

## Verification

Fast policy, result-corruption, process-environment, output-bounds, PNG-preflight, selector/reopen and no-Docker-on-invalid-input checks run in `npm run verify`. Real Docker checks require explicit opt-in:

```sh
EITRI_FROZEN_DOCKER_ACCEPTANCE=1 \
EITRI_APPLICATION_FIXTURE_DIRECTORY=/canonical/path/to/eitri-test-web-app \
node --test test/integration/controller-application-check.test.ts
```

These tests use the actual controller, catalogue/native SQLite, managed Git, brokered edits, frozen transfer, Docker, unit/build/browser recipe and artifact APIs. They verify independent profile/cart red-to-green runs, preserved baseline bytes after an edit, two distinct revision-bound real receipts per case, durable evidence/PNG reads on reopen without model/check replay, unchanged original capture digest and owner-filtered absence of per-run resources. Exceeding the finite execution/output limits is a blocked attempt, never a substituted success. The first implementation exposed intermittent browser crashes before the subreaper was added; those failed invocations are retained separately and are not counted as passing runs.

The [verification and review record](evidence/fixture-application-check/verification.md) records actual outcomes and limitations. Full M2 evaluation and later human-presence gates remain open.
