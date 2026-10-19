# Frozen browser validator acceptance

## Result and scope

The importing controller engineer has a real-Docker acceptance result for the existing unwired `FrozenBrowserValidator`. At source revision `352bf1568b176d9afd4351aca5e2c9c8fc6731e4`, the [complete Docker suite](validator-final-docker.txt) passes all 20 tests with no failures or skips. The [local verification run](validator-final-node.txt) passes lint, formatting, type checks and all 311 tests.

This accepts the fixed synthetic browser-validator contract only. The implementation remains on `fix/validator-acceptance` in `../eitri-validator-acceptance`, not merged into main or imported by production entry points. Its tip `88f89090de567fa6eb10afc9f5f196892a22731f` adds only acceptance documentation beyond the tested executable source, as recorded by the [source identity check](validator-source-identity.txt). M2, controller integration, real fixture validation, project Node execution and later human-presence gates remain incomplete. No integration-credential lookup, live service activation, application inference, repository push, PR or deployment occurred.

The next maintainer inherits unconditional retention of synthetic fixture directories. Failed assertions cannot erase ownership accounting. The intentional unresolved-build case still retains uncertainty and blocks further admission. It does not become successful cleanup because a current Docker listing is empty.

## Inherited state

Main stopped at `fff8347`. The process-discovery replacement and screenshot-preparation regression were verified on isolated branches. The continuation started from `09dd3372ca5c9966c47800b89cadcb4fc42b3ac7` without replaying the old validator worktree's uncommitted parser attempt.

An initial local verification run hit the parent's 120-second outer timeout. The completed baseline and final runs used a 900-second outer allowance. The final passing log is linked above. This was an interrupted check, not an observed test assertion failure.

The existing request binds a recorded frozen revision, case, action, epoch, protected scenario, baseline or candidate role, and allowance. Reports separate behavioral outcome, cleanup and verified provenance. No production API, storage schema, driver, watchdog, policy, privilege, launch flag or resource ceiling changed in this continuation.

## Repairs

### Preserve ownership through harness failures

The [preflight source review](validator-preflight-review.md) found that fixture teardown deleted its root unless callers explicitly retained it. Ordinary failures could therefore erase unresolved ownership accounting. It also found that the cancellation test could pass with an acquired ID without observing a running container.

The [protected old-source reproduction](validator-retention-red.txt) removed only the explicit retention call from the synthetic lost-build case. An outer filesystem interceptor rejected root deletion instead of performing it. The fixture reached that forbidden deletion path with an unresolved build. The original accounting remains retained.

Commit `8fe2b81a0dd2b48f3c25a165ac56e571f7baed91` removes the retention switch and root deletion. It prints each fixture path before fallible setup. A fixture-local finalizer attempts every owned cleanup before reporting aggregate failures. The [Node hook probe](validator-teardown-node-probe.txt) established why independent `t.after` hooks were insufficient on Node 26.5.0. A thrown hook prevented the later hook from running.

One private helper now serves both auxiliary-container consumers. A `sentinel | dependent` purpose determines its unique name and fixed label. Cleanup registration precedes create. Removal verifies name, label, image and immutable ID, then confirms absence through successful bounded listings. A lost create response remains visibly unresolved even after an empty listing. The helper never globally prunes or removes validator-owned images.

Cancellation requires inspection of the acquired owned container reporting running. Failure paths abort and drain validation. Owned crash helpers are killed and awaited. Existing outcome, ownership, incomplete-cleanup and reconciliation assertions remain. The only production-file edit is deletion of one ambiguous non-API comment. [Fresh delta source and comment review](validator-harness-review.md) passed.

### Exercise active watchdog expiry

The [first full Docker run](validator-first-docker.txt) passed 19 of 20 tests. The host-crash test expected exit 124 but observed exit 1. The retained container [inspection and log](validator-watchdog-container.txt) show `frozen-driver-failed` before the original 30000-millisecond deadline. [Recovery](validator-watchdog-recovery.txt) retained uncertainty, did not replay work and confirmed owned removal.

The exact internal driver exception was not captured. Bounded click and screenshot operations are a source-supported explanation for the early exit, not a proved exception diagnosis. The established defect was the test's assumption that this trigger must survive until its later deadline.

Budget-only [8000-millisecond](validator-watchdog-8000-prototype.txt) and [10000-millisecond](validator-watchdog-10000-prototype.txt) prototypes both preserved the exact exit-124 assertion and passed. Commit `352bf1568b176d9afd4351aca5e2c9c8fc6731e4` uses 8000 milliseconds only in the active-watchdog test. It additionally requires the recorded container to be observed running before its original deadline. The delayed-start test retains its 30000-millisecond allowance. No deadline resets or alternate accepted exit codes were added.

The [focused final-candidate Docker check](validator-watchdog-fixed.txt) passed. [Fresh delta source and comment review](validator-watchdog-review.md) passed before the final complete run.

## Design and ownership

The designed playbook was preflight, protected reproduction, narrow repair, focused real-surface checks, exact-source review, complete acceptance and evidence audit. Rigor remained high because process crashes and daemon effects cross trust boundaries.

Two designs compared unconditional retention with selective reclamation from journal state. The parent and [independent judge](validator-design-review.md) selected unconditional retention. Selective reclamation would duplicate storage knowledge without a required benefit. The runtime hook probe justified only a small fixture-local cleanup list, not a storage decoder or generalized resource framework.

The judge proposed a mocked harness matrix. The parent instead kept production interfaces unchanged and ran source-extracted lifecycle checks plus protected actual-Docker failure injections. These are verification tools, not alternate production execution routes.

- Blocking prerequisites were source identity, fixed engine/base, approved policy and fresh review before full Docker execution.
- One isolated source owner worked at a time. Read-only design and review artifacts were separate.
- The parent alone ran Docker. Each fixture retained its own workspace, journal and resource names.
- Repairs were separate checked commits. The existing suite was reused before any controller integration.

Model the Domain kept outcome and cleanup independent and bound auxiliary names and labels to purpose. Laziness Protocol removed the unsafe retention decision instead of adding another journal parser. Fix Root Causes corrected the test trigger rather than accepting exit 1. Test Behavior, Not Implementation required running witnesses and literal outcomes. Sequence Work into Verifiable Units separated the repairs and checks. Build the Lever made the protected checks rerunnable scripts. Prove It Works required actual Docker, retained records and artifact inspection.

## Runnable checks

Run the complete suite from the acceptance worktree after reviewing the source and existing containment contract.

```sh
EITRI_FROZEN_DOCKER_ACCEPTANCE=1 node --test test/integration/frozen-browser.test.ts
npm run verify
```

The three checked-in diagnostic instruments run from main and take the acceptance worktree as their first argument. They and the record producer target the local `orbstack` Docker context and fixed base tag `eitri-chromium-probe:1.64.1-node26.5.0`, not portable Docker defaults.

```sh
node docs/evidence/frozen-browser/check-harness-retention.mjs ../eitri-validator-acceptance
node docs/evidence/frozen-browser/check-harness-finalizer.mjs ../eitri-validator-acceptance
node docs/evidence/frozen-browser/check-harness-failures.mjs ../eitri-validator-acceptance dependent
node docs/evidence/frozen-browser/check-harness-failures.mjs ../eitri-validator-acceptance created-only
```

All four commands passed against the final source.

- The [retention check](validator-retention-green.txt) verifies readable ownership and unknown-build accounting after teardown without an opt-in call.
- The [finalizer check](validator-finalizer.txt) executes the extracted fixture callbacks. It verifies both retained errors, later workspace closure, partial setup and termination of a real stopped helper.
- The [dependent failure check](validator-dependent-failure.txt) injects an assertion immediately after acquisition. The child test must fail. Teardown removes the verified helper, keeps accounting, and parent recovery confirms the committed baseline outcome and owned removal.
- The [running-witness check](validator-created-only-failure.txt) suppresses the test's positive running observation while real execution continues. The child test must fail. Validation still aborts and drains; the helper is removed and the cancelled report retains owned cleanup. This is an injected observation failure, not a claim that Docker actually stayed in created state.

The injected failures are expected negative results. They are not counted as passing integration tests. The instruments create private copies of the test under `.audit`, retain their synthetic data, and do not modify checked-in source. The failure-injection and finalizer tools assert their source extraction points. The retention tool instead rejects root removal and verifies surviving accounting. Its removal of the old opt-in call is compatibility for the old source, not a required extraction point. The separate `teardown-probe.test.mjs` intentionally fails to demonstrate Node's old hook behavior.

## Record reproduction

The record producer resolves the explicitly supplied tested revision through Git. It checks executable identity against the current checkout, reads the retained stores without writing them, exports the summary and PNG, validates the artifact and captures successful Docker listings with commands, exit status and stderr. The transcript remains the evidence for which revision produced the original test log.

```sh
node docs/evidence/frozen-browser/record-validator-acceptance.mjs ../eitri-validator-acceptance docs/evidence/frozen-browser/validator-final-docker.txt 352bf15
```

This command passed after the audit. It requires the retained temporary fixtures and fails if they are missing. A successful rerun refreshes the environment and resource snapshots. The current snapshot follows the final suite and the later red and green retention reruns, not the suite directly. Store and observation JSON content and the PNG digest were unchanged. Environment and resource records now identify their fresh capture time and both revisions. The original inline producer used a hardcoded source-revision field. The checked-in producer instead resolves the supplied ref and verifies the source comparison.

The committed red-retention output was regenerated with the diagnostic's explicit target revision and clean-source check. Earlier local reproductions used different temporary fixture roots. The committed copy of the first failing Docker log removes only whitespace padding from two blank lines. Its original output remains at `.audit/validator-acceptance-docker.txt`. The [provenance check](validator-record-provenance-check.txt) verifies the two exact line differences and original and normalized digests. It also reads the regenerated red run's journal without writing it and confirms surviving ownership and unknown-build accounting.

## Artifacts and resource limits

The final suite retained 13 fixture directories and 39 settled run records, recorded in the [store summary](validator-final-stores.json). Exactly one deliberate lost-build case retains unknown build state and incomplete cleanup. The [artifact check](validator-artifact-check.txt) verifies these records and the exported PNG's byte integrity.

The [actual frozen-A observation](validator-final-observation.json) records request, provenance, runtime witnesses and artifact digest. The [PNG](validator-final-A.png) was exported from that saved report, validated and directly viewed by the parent. It shows the synthetic Run control and literal A.

The [environment record](validator-environment.txt) identifies Node 26.5.0, Docker 29.4.0 on ARM64, builtin seccomp and the fixed local image. The [final resource listing](validator-final-resources.txt) was empty for matching containers and derived image tags at its recorded time. It is not proof that a lost daemon response can never produce a later effect.

Fixture data from prototypes and protected checks remain in addition to the final suite's directories. Build cache remains retained. Physical daemon allocation and disk reclamation are not bounded or established by this run. There was no global pruning, fixture-project mutation, restriction change, power-loss proof or same-UID-adversary proof. Rust code was unchanged and not retested.

Source reviews used the configured `openai-codex/gpt-6.1-sol` family. Fresh contexts do not provide different-family source assurance. The separate [cross-family evidence audit](validator-acceptance-audit.md) passed. Its remaining limits are recorded below.

The audit's record-production concerns were addressed by the checked-in producer, explicit red/green revision headers and fresh command-bearing resource/environment snapshots. The pre-audit [environment](validator-environment-before-audit.txt), [resource](validator-resources-before-audit.txt) and [red-retention](validator-retention-red-before-audit.txt) copies remain available. The missing `8fe2b81` checkpoint was appended to `decisions.tsv` without backdating. Raw review artifacts preserve the reviewer's original wording. This section records their disposition. A fresh [post-audit review](validator-audit-follow-up.md) passed the record fixes. Its non-blocking context and temporary-data qualifications are included above.

## Audit limits

The active-watchdog trigger is timing-coupled. Its 8000-millisecond deadline must expire before the busy-page driver's own early failure. A missed running witness or an early exit 1 fails rather than passing. A future timing failure needs diagnosis, not a broader accepted exit code.

Wrong-label, wrong-image and wrong-ID refusal, failed lookup, removal or confirmation, a delayed lost-create response and inspection failure during cancellation draining were not separately exercised at runtime. These branches have source review, not runtime proof. The protected actual-Docker checks directly cover the two preflight defects. The final suite also exercises repeated auxiliary cleanup. No broader negative-branch claim is made.
