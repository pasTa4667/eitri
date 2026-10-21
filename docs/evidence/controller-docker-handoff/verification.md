# Actual Docker controller handoff verification

## Accepted unit

Source commit `2851c4b041f210d545127fdc4289e1772d856340` adds `test/integration/controller-consumed-report-handoff.test.ts` after baseline `800c8fc7f278e77778d503df162c8c9f8a100af4`. This bounded M2 prerequisite verifies the existing controller/native handoff against actual Docker execution. It changes no production API or activation path.

The test uses genuine faux-provider `complete_assessment` and baseline `run_check` calls. The configured callback accepts and consumes the scoped worker request, then returns the payload-free consumed-browser marker. It supplies no report, outcome, PNG, or execution pins.

The two isolated synthetic HTML cases assert literal outcomes. A records `baseline-reproduced`, a passed real receipt, and the selected base revision. B records `baseline-not-reproduced`, a failed real receipt, and no base. Both cases remain simulated because their model provider is faux.

The suite compares original selected requests, independent controller admission facts, acceptance, exact consumed-run identity, settled report, receipt provenance, and actual PNG bytes. It checks resource acquisition IDs and live Docker absence separately from historical cleanup. After close/reopen, it requires unchanged receipts, artifacts, PNG bytes, facts, history, inventory, and counters. Recovery must increment the case epoch exactly once and preserve every other case field.

## Design and review

Two independent GPT sketches compare a standalone suite with an extension of the existing Docker suite. The parent and fresh GPT cross-judge select the standalone file to avoid refactoring existing coverage. The selected design uses public observation and journal-only inventory APIs. Bootstrap initialization closes before controller admission. Each case owns a separate temporary root, workspace, journal, and resource owner.

The cross-judge corrects an invalid sketch call to private default-validator inventory. Implementation obtains pins through a reopened journal-only interface instead. The parent also corrects the sketch's session-result count. Genuine assessment creates one action-result in addition to the baseline result. The test requires exactly those two and matches the baseline result to its real receipt.

Fresh `openai-codex/gpt-6.1-sol` correctness/security review finds no defects and approves actual execution after hash confirmation. A separate GPT comment audit requests one deletion, which the parent applies without changing behavior. A fresh GPT follow-up reviews the later epoch correction, finds no issues, and retains the execution approval. Reviewers inspect source but do not run Docker. Independence is by fresh context, not model family. The configured provider name `openai` is unavailable, so delegation uses the registered `openai-codex` provider with the same GPT model.

Parent verification confirms the reviewed initial file hash before the first execution. The final reviewed, executed, and committed file hash is recorded in [source identity](source-identity.txt). The only changes after initial review remove one comment and correct the exact reopened epoch expectation.

## Parent checks

Run from the isolated implementation worktree with Node 26.5.0.

```sh
npm run verify:all
EITRI_FROZEN_DOCKER_ACCEPTANCE=1 node --test test/integration/controller-consumed-report-handoff.test.ts
```

Final `verify:all` passes 1,219 Node tests and 30 Rust tests. Lint, formatting, type, and syntax checks pass. There are no failures, cancellations, skips, or ignored Rust tests. Existing Rust dependency future-incompatibility warnings remain.

The final actual-Docker command passes both tests with no failures, cancellations, or skips. The engine reports ARM64 Docker 29.4.0. The existing local base is `eitri-chromium-probe:1.64.1-node26.5.0`, image ID `sha256:57911b2d47725e1d19e25203b82d7c90a3160da1815f78a9c66b42a89dd1ddff`. The test verifies that base remains unchanged.

The missing-opt-in invocation exits 1 with the required security-review message. It does not skip or substitute transcripts. Ordinary `npm test` excludes `test/integration/` and remains Docker-free. Parent protected-byte checks confirm unchanged tracked production source, worker assets, Chromium policy/probe files, dependencies, and Rust source.

The implementation writer reports 403 focused fast tests passing. Parent baseline checks independently pass 99 focused tests. These are separate from the final parent full and actual-Docker runs.

## Retained failed checks

The first parent full baseline command reaches its 200-second shell timeout. It is not a pass. Both later parent full runs complete successfully in the implementation worktree.

The first actual-Docker run fails both tests at reopened case equality. Each observed case differs only in epoch, from 4 to 5. `Controller.recover()` deliberately increments epoch on open. A fresh writer changes the expectation to the original case plus exactly one epoch increment. No production behavior changes. That red run stops before later reopen assertions and is not counted as completed persistence proof. The final green run executes all assertions.

Raw logs remain local in the main checkout under `.audit/next-m2-*`. Key records are `next-m2-actual-docker.log`, `next-m2-actual-docker-final.log`, `next-m2-parent-final-verify-all.log`, `next-m2-missing-opt-in.log`, and `next-m2-protected-hashes.log`. The two final synthetic roots are retained under the host temporary directory and printed in the actual-Docker log. They contain native SQLite stores, journal, PNG evidence, snapshots, and Docker-read diagnostics. The test does not remove them.

## Limits and remaining work

This proves actual synthetic browser execution through controller/native admission and persistence. It does not validate the monitored application, complete M2, prove a genuine model fix, or activate production dispatch. Production main and HTTP configuration remain unchanged. Actual fixture/scenario integration is still required before M2 acceptance.

Containment policy, worker resources, and ownership-checked cleanup remain unchanged. Successful current resource listings do not prove perpetual daemon quiescence. Worker/controller/native writes remain non-atomic. Build cache and diagnostic roots remain retained. No global prune, image pull, monitored fixture edit, credential access, live service, application inference, remote publication, or deployment occurs. Later human-presence gates remain open. No remote is configured, so PR creation is skipped.
