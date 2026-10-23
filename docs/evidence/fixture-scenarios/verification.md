# Guarded fixture scenarios

## Result

Source `25c8a60` implements the next bounded M2 fixture increment after [built-bundle validation](../built-bundle/verification.md). Operators can run the existing guarded recipe to exercise both latent defects and both deterministic controls. Maintainers inherit one finite scenario contract and one contained execution path.

The extension exists in disposable fixture copies. The original demonstration checkout is unchanged. This is not production activation, an AI-generated repair, immutable controller application validation, or M2 acceptance.

[Retained observations](observations.json) contain source identities, actual unit results and retry witnesses, browser results, build inventories, response-byte proof, failure diagnostics, compatibility controls, and resource-removal records.

| Variant | Unit pass | Unit fail | Browser pass | Browser fail |
|---|---:|---:|---:|---:|
| Baseline | 30 | 0 | 8 | 0 |
| Profile regressions on baseline | 30 | 5 | 8 | 1 |
| Profile-only scripted candidate | 35 | 0 | 9 | 0 |
| Cart regressions on baseline | 30 | 2 | 8 | 1 |
| Cart-only scripted candidate | 32 | 0 | 9 | 0 |

One run of the shipped recipe and one run of an instrumented copy produce these results. Every variant builds successfully, passes response-byte provenance, and stops preview. The red rows fail only their designated assertions. No tests are skipped or retried. Profile and cart candidates use identical regressions to their respective red rows. Each candidate changes only its own helper.

## Scenario contract

`scripts/profile-reconciliation/scenarios.mjs` owns four scenarios and five fixed variants. Required tests, literal outcomes, and diagnostic admission remain outside editable fixture source. Generated application metadata contains reporting descriptors, not expected outcomes or admission policy.

- `profile-name` retains the earlier normal behavior and missing-user/profile defect.
- `cart-total` shares one helper with the actual UI. Nonempty totals pass. Red probes expose its missing reduce initial value on an empty cart. The cart-only scripted patch adds `0` and produces `Total: 0 cents`.
- `expected-validation` reports a handled `SyntaxError` and displays `Enter valid JSON.`. Corrected input clears the error and displays `Configuration accepted.` without another report.
- `transient-upstream` fails on the first press and succeeds on subsequent presses. Component-local state advances only on user action. Actual checks cover StrictMode, repeated presses, remount, reload, and a fresh browser context. No external upstream is called.

Normal checks remain green while both defects are latent. Target regressions are added only to that target's red and candidate copies. The legacy uncaught click and async routes remain separate checks.

Reporting uses stable scenario tags and fingerprints. `eitri-fixture-scenarios-v1` is a synthetic contract label, not a Git revision or deployed-build identity. Per-variant source inventories provide separate immutable byte identities. Explicit validation mode never initializes Sentry. Demo reporting requires an explicit demo label and externally supplied DSN. Offline tests use doubles. No live telemetry delivery is established.

## Verification and corrections

Parent `npm run verify:all` passes 1,785 Node tests and 30 Rust tests, including lint, formatting, and type checks. Its baseline passes 1,777 Node tests and 30 Rust tests. An earlier baseline command ends at the harness's 120-second timeout and is not counted as a pass. The completed baseline uses a sufficient command deadline. After committing source, parent reruns type checks and all 17 focused recipe tests successfully. Every retained runtime asset hash matches commit `25c8a60`.

The first actual application run passes the baseline and both profile variants. It blocks on cart red because Vitest abbreviates the received text in its string assertion. The correction supplies the full received text as that assertion's message. It preserves the literal zero-total expectation and the strict reduce diagnostic requirement. The later shipped-recipe run and instrumented-copy run each pass all five variants.

The runner retains parsed unit and browser reports and the unit witness before admission. The witness records the pinned Vitest reporter's actual retry, repeat, expected-failure, module-error, and unhandled-error fields. Bounded report reads and exact title, file, status, and diagnostic checks reject weakened outcomes.

An instrumented disposable recipe additionally rejects development-server substitution, same-size JavaScript mutation after inventory, missing `dist`, and a failed Vite build. Preview stops after every control. The control run also repeats all five normal variants. Production assets contain no negative-control switches.

Fresh final `openai-codex/gpt-6.1-sol` review reports no material Standards or Spec findings. It inspects the parent compatibility increment, diagnostic correction, report retention, and actual runtime reports. Its comment audit finds no new application comments or suppressions. The vendor seccomp annotation remains to preserve exact upstream bytes. Review independence is fresh context within Codex, not model-family diversity or independent test execution.

## Exact-engine compatibility

Read-only preflight finds installed Docker 29.8.2 rather than the recipe's earlier 29.4.0 pin. The compatibility increment pins 29.8.2, ARM64, and commit `8af9fe3a36bab3e039862a2ab1cef1880c9b4d03`. Only that full commit or its exact observed seven-character spelling is accepted. Other versions, architectures, and commits are rejected.

The baseline comes from [the inspected Moby commit](https://github.com/moby/moby/commit/8af9fe3a36bab3e039862a2ab1cef1880c9b4d03). Its [vendor profile](https://raw.githubusercontent.com/moby/moby/8af9fe3a36bab3e039862a2ab1cef1880c9b4d03/vendor/github.com/moby/profiles/seccomp/default.json) has SHA-256 `536529b665dd0972c37bfb569f5d4ac8a53592e7b00752bc39ff063ca9864c74`. The resulting custom profile has SHA-256 `1ccf001ef888765cf5e09948c6060646e88391517f8261bbb2781096a5e1bfce`.

The modern baseline adds a LoongArch mapping and denies AF_ALG sockets. The recipe preserves that restriction and adds only the existing seven exact ARM64 namespace and chroot rules. Existing prototype files and the older shared policy remain unchanged.

A standalone actual probe verifies Chromium namespace and seccomp sandbox status, no `--no-sandbox`, denied host-source/home-sentinel/socket access and egress, retained negative namespace controls, read-only root, and resource ceilings. Separate actual socket checks admit AF_INET and reject AF_ALG and AF_VSOCK with EPERM. Both owned probe containers are removed. These observations establish the bounded tested contract, not a general container-security guarantee.

## Isolation and rerun

The recipe still admits exactly the original 16 pre-edit files and verifies their identities before applying either fixed patch. Original `.env`, existing `dist`, README, Git metadata, and dependency directories are not acquired. Parent separately compares the sibling's 16 allowlisted file sizes, hashes, inodes, and modification times before and after and finds no change.

Preparation uses the existing locked package files and `npm ci --ignore-scripts`. Registry access is limited to that preparation. All application checks run offline in non-root ARM64 containers with no mounts, dropped capabilities, read-only root, no-new-privileges, and unchanged resource ceilings. No host fixture program runs. No global Docker setting changes.

Run the recipe from the repository root.

```sh
node scripts/profile-reconciliation/verify.mjs \
  /absolute/path/to/retained-preedit-snapshot \
  /absolute/path/to/new-evidence-directory
```

The source must match `inputs.json`. The output directory must not exist. The exact reviewed engine, local base image, and `orbstack` context are prerequisites. The recipe now rejects the older engine pin rather than accepting arbitrary versions.

Every application run removes its owned containers, dependency and runtime tags, base alias, and scratch. Parent independently queries owner-filtered resource listings and alias identities and finds none. Reports and Docker build cache remain. Cleanup is not a disk-reclamation claim.

## Design and throughput

| Alternative | Decision |
|---|---|
| Extend the guarded recipe with a finite scenario manifest | Selected. Preserves one command and existing lifecycle ownership. |
| Add a second scenario command and extract shared containment | Rejected. Adds caller coordination and moves security-sensitive code without a needed caller. |

The selected design adopts route-derived render-error attribution, explicit latent versus control records, corrected-input checks, and unaffected-helper identity checks from the alternative. It rejects a baseline-only alert prerequisite that would prevent identical regressions from passing the candidate.

- Blocking work establishes scope, retained inputs, and existing recipe behavior before design comparison.
- Independent design outputs use separate files. One writer owns coupled recipe, manifest, overlay, and regression changes.
- Original inputs remain read-only. Parent owns the later engine compatibility change and final runtime checks.
- One implementation owner is the smallest safe split because file identities and exact expected result sets must agree.

Model the Domain places expectations in one finite manifest. Laziness Protocol preserves the existing recipe. Test Behavior, Not Implementation requires literal helper and UI outcomes. Prove It Works requires actual contained execution and original-file comparisons before acceptance.

## Limits and local trail

The live frozen validator in `src/frozen-browser.ts` still requires Docker 29.4.0 and the older shared policy. It rejects the installed 29.8.2 engine with `unreviewed-docker-engine`. This step repins only the standalone fixture recipe. The two paths cannot currently run on the same engine. A separately verified validator compatibility migration is required before its opt-in Docker acceptance and controller integration tests can run on this host. This is an open M2 prerequisite, not a passing integration claim.

Provenance covers one dedicated navigation per variant, not every request in every scenario. The standalone compatibility probe inspects sandbox internals. Application variants request sandboxing and reject its disabling flag but do not each repeat that internal inspection.

The overlay is not installed into the monitored sibling. Immutable full-application controller validation, the fixture's local baseline commit, complete M2 acceptance, and later human-presence gates remain open. Production main, controller intake, dependencies, Rust, and frozen-worker assets are unchanged. No credential read, live Sentry call, application inference, publication, deployment, branch rename, or remote write occurs. No remote is configured, so opening a PR is skipped.

Local raw evidence is `.audit/next-fixture-step/runtime-final/report.json`, `runtime-controls/report.json`, `runtime/report.json`, `compatibility-probe.json`, `modern-sockets.json`, `baseline-verify-all-complete.txt`, `final-verify-all.txt`, `final-review.md`, `committed-focused.txt`, and `original-{before,after}.json` under the same directory. The local control producer is `prepare-controls.mjs`. The local evidence producer is `record-evidence.mjs`. `decisions.tsv` records the decision trail. A different-family `anthropic/claude-opus-5-5` evidence audit identifies the live engine-pin conflict, stale rerun instructions, ambiguous run labeling, and retroactive log timing. The documentation and appended trail corrections address those findings. The live validator compatibility migration remains open. The audit does not rerun checks or inspect committed source independently. These local paths are not portable prerequisites for the normal recipe.
