# Protected profile-name probe verification

## Accepted unit

This continuation starts at `ca981f6f80e0b6081c71c6fcaf4c0a4a2019e078`. Implementation commit `92cbed2` adds the protected helper scenario. Follow-up `4675c77` fixes two GPT review findings. The [reference](../../profile-name-probe.md) defines the bounded contract.

Importing colleagues can select `profile-name-v1` through the existing frozen-browser request. The maintainer inherits one fixed definition and the existing execution, admission, cleanup, and recovery machinery. Production dispatch remains unwired.

The actual demonstration helper is captured without modifying its checkout. A scripted fix changes only a managed workspace. This is helper-level browser evidence, not React validation, a genuine model fix, protected-test reconciliation, or M2 completion.

## Design and ownership

Two independent GPT sketches compare a typed scenario with an A/B adapter. Parent and fresh GPT cross-judge select the typed scenario. The selected design removes request-level capture repetition, a binding API, per-case realms, duplicated drivers, configuration selectors, and redundant A/B summaries.

The cross-judge blocks the original sketches on dynamic-import substitution and candidate exception getters. The amended design statically imports the helper through a protected wrapper and invokes its remote function handle through CDP. Candidate calls return bounded primitive facts without inspecting thrown properties. Only the byte-pinned reviewed helper permits native diagnostic extraction.

One isolated writer owns the coupled source and tests. A fresh replacement finishes the preserved work after the first writer reaches its elapsed limit. Design artifacts have separate output paths. Grounding and design precede implementation. Offline checks and source review precede actual candidate browser execution.

Model the Domain chooses a finite scenario and actual-value vector. Laziness Protocol reuses the executor and removes speculative public APIs. Exhaust the Design Space supplies two competing sketches. Separate Before Serializing Shared State isolates outputs and code ownership. Sequence Work into Verifiable Units separates implementation, review repairs, and browser acceptance. Build the Lever leaves rerunnable Docker tests. Test Behavior, Not Implementation requires independent literal expectations and exact-route poison fixtures. Fix Root Causes puts checks before unsafe indexing and at complete-evidence admission. Prove It Works requires actual captured bytes, managed candidates, and current resource observations.

## GPT review

Fresh `gpt-6.1-sol` review finds two defects before actual candidate browser execution:

- P1. A trailing high surrogate can trigger an out-of-range `String.prototype` getter during trusted result validation.
- P2. Detached admission can accept a complete passing vector whose manifest omits the helper.

The repair checks string bounds before indexing and requires the designated helper in complete profile manifests. Candidate hashes remain independent of baseline bytes. Three targeted tests fail before the repair. The repaired declaration returns `invalid-return` without getter events and still accepts a well-formed astral string.

A fresh GPT follow-up finds no new defect and clears source review for actual Docker execution. The [initial review](correctness-review.md), [follow-up review](followup-review.md), and [comment audit](comment-audit.md) are retained. Review independence is by fresh context within the configured GPT family, not different model families. The reviewers inspect source; parent checks own the runtime results and hash computations. The final [evidence audit](evidence-audit.md) supports finite-step completion without a blocking contradiction. It does not independently recompute fixture preservation or replay historical failures, and its filtered tool trail establishes sequencing rather than every negative scope claim.

The comment audit accepts one platform-constraint comment, requests one deletion, and asks for a clearer local guard name. Both requested edits are applied. The later repair adds no comments.

One earlier reviewer stalls in a home-directory discovery operation before reading target code. The parent interrupts it and launches the explicitly scoped reviewer. That interrupted attempt supplies no review verdict.

## Parent verification

Final source runs with Node 26.5.0 and OrbStack Docker 29.4.0 on ARM64:

```sh
npm run verify:all

EITRI_FROZEN_DOCKER_ACCEPTANCE=1 \
EITRI_PROFILE_NAME_FIXTURE_DIRECTORY=/Users/felix.langbein/projects/eitri-test-web-app \
node --test test/integration/profile-name-probe.test.ts

EITRI_FROZEN_DOCKER_ACCEPTANCE=1 \
node --test test/integration/frozen-browser.test.ts \
  test/integration/controller-consumed-report-handoff.test.ts
```

Final `verify:all` passes 1,258 Node tests and 30 Rust tests. The profile Docker suite passes all three tests. Existing synthetic/controller Docker suites pass all 22 tests. All final checks have zero failures, cancellations, skips, and ignored Rust tests. Lint, formatting, TypeScript, and configured syntax checks pass. Existing Rust dependency future-incompatibility warnings remain.

Actual profile acceptance executes 17 managed runs. It verifies the original frozen baseline after editing a candidate, the nine literal fixed results, the measured TypeError, honest uppercase/untrimmed baseline outputs, wrong-case/constant/partial candidates, syntax and export failures, arbitrary exceptions, exported `then`, returned thenables, poisoned intrinsics, throwing error properties, DOM spoofing, navigation, and the trailing-surrogate getter regression.

The exact protected wrapper and document routes have malicious snapshot counterparts. They remain in frozen input without becoming result authority. PNG bytes, checksums, frozen/helper identities, report admission, cleanup, and durable reopening are checked. The parent independently reopens all 17 settled runs across the three retained profile roots. Current Docker queries find no containers or derived images with those profile-owner labels. Retained roots and daemon build cache are not removed. Deliberate unresolved synthetic failure scenarios are not described as global daemon cleanup.

Raw parent logs remain local at `.audit/profile-probe-final-verify-all.txt`, `.audit/profile-probe-actual-docker.txt`, and `.audit/profile-probe-synthetic-docker.txt`. Every final command exits zero. `.audit/profile-probe-current-resources.json` records the later resource observation.

## Source and fixture preservation

The six final source/test identities match the reviewed bytes in the [source identity record](source-identity.txt). Parent checks find all 36 protected tracked files unchanged, including production dispatch, workspace/capture code, containment, dependencies, and Rust source.

The sibling helper remains 525 bytes with SHA-256 `5fa6710bb0c4f120408d489d0b16f6a21bfc6e539081ab1d9fda7a3bddb1fa07` and capture digest `4a0ca6e84af5aa34eb429049c177762746b9acc0c6c0f35d75503900e51c2312`. Its device/inode, mode, size, modification/change times, and repository status match the initial observation. No original baseline commit is invented.

Before implementation, a parent diagnostic script measures the exact TypeError using the existing restricted synthetic executor and captured helper. That run reports `unrelated-failure` under synthetic classification. It is diagnostic calibration, not profile acceptance. Later exact-ID Docker listings confirm its derived image and container are absent. An earlier image-reference filter was insufficient for an image-ID absence claim and is superseded by the exact-ID observation.

## Retained incomplete and failed checks

The first writer's full suite passes 1,253 of 1,254 Node tests. Its sole failure is an existing COPY-context assertion that expects the old raw scenario asset rather than the newly serialized protected definition. The assertion is corrected without weakening asset identity. The second run is interrupted by the writer's 30-minute outer limit and is not counted as a pass. Uncommitted work is retained and finished by a fresh writer.

Parent verification of the first integrated source independently passes 1,254 Node and 30 Rust tests before the security findings are repaired. That pass does not certify final source. The final full command runs again after both fixes and produces the totals above.

The repair's first static run catches a readonly assignment in its new test. That test setup is corrected before passing checks. The three red regression results remain separate from later green runs. No actual-Docker acceptance failure occurs in the final source runs.

## Open boundaries

The finite suite measures sequential helper calls and can still be hardcoded completely. Detached admission proves consistency, not execution authorship. Existing same-UID and source-acquisition limits remain.

React integration, protected baseline-test reconciliation, other demonstration scenarios, M2 completion, controller activation, genuine subscription inference, credentials, live services, publication, and deployment remain outside this unit. No `.env` or `dist` contents are read. No remote is configured, so PR creation is skipped.
