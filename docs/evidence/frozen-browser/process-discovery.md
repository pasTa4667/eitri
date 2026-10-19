# Process discovery without command-line parsing

## Scope

This work replaces process discovery and security-role attribution in the unwired frozen-browser validator. It does not complete M2, enable generated Node execution, or change production entry points.

The operator authorized prototypes and implementation with a forty-minute stop condition. Work started at 2026-10-19T14:07:12Z. The deadline is 2026-10-19T14:47:12Z.

## Reproduction

The parent created `../eitri-process-discovery` on `fix/kernel-process-discovery` from `bdb71bb`. Existing uncommitted parser changes in `../eitri-frozen-browser-validator` remain untouched. Their original diff is also preserved in `.audit/pre-process-redesign.patch`.

The parent ran `node .audit/process-discovery-runtime.mjs baseline` against actual restricted Docker. Chromium emitted literal A and a screenshot. The host returned `infrastructure-failed` with `frozen-browser-check-failed`. Its process list contained only the browser and two crash handlers. Owned container and derived image removal succeeded. `.audit/process-discovery-baseline.json` retains the complete diagnostic.

The existing committed regression also failed before implementation. The command was `node --test --test-name-pattern='collects all roles from captured' ../eitri-process-discovery/test/frozen-browser.test.ts`. Its actual list contained three processes, while the expected list contained twelve. `.audit/process-discovery-red-tests.txt` retains the failure.

## Prototype evidence

A temporary driver instrument used `browser.newBrowserCDPSession()` and `SystemInfo.getProcessInfo`. It independently collected every numeric top-level `/proc` entry and its kernel security fields. It did not use command lines to select those records. The temporary instrument was removed before implementation. Its patch is `.audit/process-discovery-prototype.patch`.

The actual Docker prototype observed seven CDP records and fifteen kernel process records. CDP supplied one browser and three renderers, plus graphics and service processes. The kernel census also found helpers, reparented crash handlers and a zombie that CDP omitted. Every renderer had kernel parent PID35. That parent carried the already-observed namespace-local SYS_ADMIN mask. These PIDs describe this sample only.

The initial user namespace had zero effective, permitted and bounding masks. Several nested-namespace processes had bounding mask `000001ffffffffff`, including renderers and a zombie with zero effective and permitted capabilities. PID35 had effective and permitted mask `0000000000200000`. Nested records had exact single-entry UID and GID maps for 1001 and nested PID identities. The current universal zero-bounding rule therefore rejects legitimate observed nested records independently of the parser bug.

The prototype remained an infrastructure failure because its diagnostic fields were not part of the accepted protocol. It is feasibility evidence, not acceptance. `.audit/process-discovery-prototype.json` retains the raw observations.

## Design decision

Two independent designs compared whole-container kernel census with CDP-rooted ancestry. Both chose whole-container census with structured browser-role annotations. A fresh cross-judge agreed.

CDP-rooted ancestry alone was rejected because reparented crash handlers were outside the browser's current descendant tree. Extending the argument parser was rejected because mutable command strings are unnecessary for membership and role identification. A single-process browser was not considered a security improvement.

The selected data shape separates PID identity, kernel parentage and lifecycle, browser role annotations, and kernel security fields. The driver owns bounded collection. The host owns acceptance. No new public validator interface is needed.

All observed container processes receive security checks. Browser-reported roles supply positive browser and renderer coverage. They do not decide which processes get inspected. Kernel parentage, namespace identity and exact capability masks define the local renderer-parent exception. This is relational evidence, not a claim to prove a semantic zygote identity.

The evidence policy corrects the nested bounding-mask interpretation explicitly. Initial-namespace capabilities remain all zero. Nested maps and PID identities remain required. Only the pinned nested bounding mask or zero can pass. Only a verified direct renderer parent with the required nested credentials can carry the exact effective and permitted SYS_ADMIN mask. No Docker capability, seccomp rule, launch flag, image binding or task limit changes.

This changes accepted evidence. It does not add runtime privileges. The independent design review confirmed that distinction. Namespace-local privileges differ from privileges in a parent namespace, as documented in [user_namespaces(7)](https://man7.org/linux/man-pages/man7/user_namespaces.7.html).

## Coverage limits

The census is a bounded observation window, not a record of every process ever created. PID identity checks and bounded retries detect observed churn without making Linux procfs atomic. Top-level process enumeration does not attest every thread. Docker's unchanged task ceiling independently enforces the process-and-thread limit.

Chromium role discovery uses its structured protocol. It is not an independent security authority. Removing argument inspection also removes claims about arbitrary runtime child flags. The fixed trusted launch configuration and sandbox witnesses remain separate checks.

## Implementation and verification

The first implementation writer stopped after a provider-overload error. Its collector and verifier edits were preserved. A fresh writer continued in the same worktree to complete the test migration. No alternate execution backend was used.

The parent ran `node .audit/process-discovery-runtime.mjs candidate` against actual Docker. The host returned `baseline-reproduced`, literal A and fifteen accepted process records. Owned container and derived image removal succeeded. `.audit/process-discovery-candidate.json` retains the report and Docker command output.

The parent then ran `EITRI_FROZEN_DOCKER_ACCEPTANCE=1 node --test --test-name-pattern='actual Docker frozen A after B' test/integration/frozen-browser.test.ts`. All seven browser outcome assertions passed. The test failed afterward on an existing assertion that compared complete results from two `exportRevision` calls. `WorkspaceStore.exportRevision` intentionally allocates a fresh random export identity on each call, while revision and manifest identity remain equal. The test must compare immutable content rather than allocation identity. The production workspace implementation needs no change. `.audit/process-discovery-docker-behavior.txt` retains that failure.

The first broadened integration run passed popup console, popup errors, popup overflow, dedicated-worker rejection and shared-worker rejection. It exposed two independent test issues. The A/B test reached teardown but attempted to remove read-only physical exports it had unnecessarily allocated. The correction uses detached `readFrozen` bytes before and after validation, which matches this validator's actual input contract and avoids physical export allocation. A separate screenshot-preparation compatibility test failed because the pinned Playwright run emitted no `screenshot-preparation-observed` marker. Its mandatory marker remains unchanged. That test remains a broader-validator acceptance blocker, not a process-discovery failure. `.audit/process-discovery-docker-acceptance.txt` retains all results.

Implementation is committed on `fix/kernel-process-discovery` in `../eitri-process-discovery`. Commit `149822b` replaces the census and verifier, migrates behavioral tests, and documents the contract. Follow-up `cdacccc4ed9274f85e6268533fc9c79d12baf119` fixes atomic publication in the test-only Docker transcript after cancellation polling exposed a torn JSON read. No production storage code changed.

The final focused actual-Docker run passed nine tests with no failures. Its command was `EITRI_FROZEN_DOCKER_ACCEPTANCE=1 node --test --test-name-pattern='actual Docker (frozen A after B|popup console|dedicated and shared)' test/integration/frozen-browser.test.ts`. The committed [test output](process-discovery-docker-tests.txt) records A-after-B behavior, baseline and candidate distinctions, unrelated failures, PNG and containment provenance, console forgery and overflow, popup console and errors, and dedicated and shared worker rejection.

A separate diagnostic against exact final commit `cdacccc` returned `baseline-reproduced`, literal A and fourteen process records. Process counts vary between runs. Its accepted report, without PNG payload bytes, is [process-discovery-runtime.json](process-discovery-runtime.json). The report includes applied settings, labels, kernel witnesses and cleanup. Owned container and derived image removal succeeded. Cache remains retained.

A fresh [exact-range source review](process-discovery-review.md) found no issues. Its preceding comment pass proposed no deletions or code changes. `node --check` passed for both trusted worker scripts.

The parent's first full Node verification exceeded its 180-second command timeout while tests were still progressing. That run is incomplete, not a pass. The final `npm run verify` at exact commit `cdacccc` passed lint, formatting, TypeScript checks and all 311 Node tests, with zero failures or skips. The [complete output](process-discovery-node-tests.txt) records that run. Rust code did not change and Rust verification was not rerun for this scoped fix.

The scoped solution was found, implemented and verified before the forty-minute deadline. A final Docker listing found no retained `eitri-frozen-browser-*` containers. The old argument-parser diff still matches its preserved SHA256 `35fef5a1535bb33e7f448dd79265f3b4aef50334bea976e3632641a940c89144`.

The solution remains on its isolated development branch. It is not merged into main because the broader validator still has mandatory acceptance gates, including the observed screenshot-preparation compatibility failure. Existing uncommitted parser work is preserved and must not be replayed over this replacement.
