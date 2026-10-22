# Profile-name controller handoff verification

## Accepted scope

Source `4253e09dc61f1ed8d7e994807e4351ca1e5e7517` adds trusted offline scenario selection through `offlineWorkspace.workerScenarioId`. The [configuration reference](../../controller-workspace.md#browser-scenario-selection) describes the interface.

The actual captured helper now reaches the protected browser probe through controller `run_check`, accepted-request consumption, settled-report retrieval, native real-check admission, and PNG persistence. Reopening preserves those records without another callback or provider turn. The case remains simulated because its provider is faux.

This completes the requested bounded implementation step. It does not establish React validation, candidate normal-path compatibility, protected-test reconciliation, a genuine model fix, or M2 acceptance. Production main remains unconfigured.

## Design and review

A fresh GPT grounding pass identifies the hardcoded synthetic scenario and the separate conflicting React tests. The parent rejects a new compatibility-preflight layer because it would not implement the missing handoff.

Two independent GPT sketches compare journal-owned and workspace-owned selection. Parent and fresh GPT cross-judge choose workspace ownership. It reuses the existing configuration mismatch guard without extending the worker-journal binding. Synthetic defaults retain the exact legacy digest preimage. Profile selection adds only its selector to the controller configuration digest. Historical requests keep their original identities.

One isolated owner implements the controller and two new test files. The parent reads the complete diff and independently passes 44 focused tests. Fresh GPT comment review requires zero deletions. Fresh GPT correctness/security review finds no P0, P1, or P2 issues and clears actual Docker execution. That reviewer independently passes 44 tests, TypeScript, and whitespace checks.

Reviews use `openai-codex/gpt-6.1-sol`, as configured. Independence is by fresh context, not model family. A fresh GPT evidence audit confirms source identities, retained runtime results, protected files, sibling metadata, PNG bytes, and transcript ordering. It finds three stale documentation claims about controller and receipt wiring. The parent corrects those claims and clarifies one adjacent historical prerequisite statement without changing source. A fresh GPT follow-up confirms all corrections, matching source hashes, and no remaining mandatory documentation corrections. The writer's original commit `c043fa19f5328f952acc785fcd86d02f59592c7d` receives only a subject amendment. All three reviewed, integrated, executed, and final source/test hashes match the [identity record](source-identity.txt).

## Parent verification

The baseline `npm run verify:all` passes 1,258 Node and 30 Rust tests before source edits. Final integrated commands are:

```sh
npm run verify:all

EITRI_FROZEN_DOCKER_ACCEPTANCE=1 \
EITRI_PROFILE_NAME_FIXTURE_DIRECTORY=/Users/felix.langbein/projects/eitri-test-web-app \
node --test test/integration/controller-profile-name-handoff.test.ts

EITRI_FROZEN_DOCKER_ACCEPTANCE=1 \
EITRI_PROFILE_NAME_FIXTURE_DIRECTORY=/Users/felix.langbein/projects/eitri-test-web-app \
node --test test/integration/controller-consumed-report-handoff.test.ts \
  test/integration/profile-name-probe.test.ts
```

Final `verify:all` passes 1,284 Node and 30 Rust tests. The new profile/controller Docker test passes. The two unchanged Docker suites pass all five tests. All final commands exit zero with no failures, cancellations, skips, or ignored Rust tests. Lint, formatting, TypeScript, and syntax checks pass. Existing Rust dependency future-incompatibility warnings remain.

The new Docker test requires the reviewed 525-byte helper and capture identity before execution. It verifies all nine baseline observations, the designated TypeError and first frame, exact request and independent admission facts, one accepted/consumed run, real receipt provenance, and PNG checksum/byte equality. Close/reopen preserves case state with the expected recovery epoch increment, receipts, messages, artifacts, facts, history, admission, and journal inventory. Replay callbacks fail the test.

The parent also extracts and opens the [actual PNG](baseline.png). It shows the protected helper observation document, not the React application. A separate post-run Docker observation finds no container or derived image for the new owner and no recorded resource IDs. The [structured record](verification.json) retains command results and identities. The unchanged suites separately check their owned cleanup.

The main verification and unchanged Docker regressions run concurrently after the new handoff passes. Their temporary stores and resource names are separate. No performance comparison is claimed.

## Boundaries and retained evidence

Parent checks find 114 protected tracked source/configuration files unchanged. The sibling helper, protected tests, application test, render page, end-to-end tests, README, package manifest, and lockfile retain their checksums, device/inode, mode, size, timestamps, and Git status. The helper remains an `uncommitted-copy`, not an original Git revision.

No original fixture edits, `.env` or `dist` reads, project Node execution, credential access, live service activation, genuine application inference, remote publication, or deployment occurs. Worker assets, containment policy, schemas, dependencies, Rust, HTTP, and production main remain unchanged. No remote is configured, and publishing this repository remains excluded, so no PR is opened.

The opt-in denial check intentionally exits one without flags, before Docker use. It is a negative gate test, not a failed acceptance run. The writer's initial test-only assertion and typing errors are corrected before its final focused checks. There is no failed actual-Docker run in this continuation.

Temporary forensic roots and Docker build cache remain retained. Current owned-resource absence does not establish physical disk reclamation. Existing same-UID, power-loss, and non-atomic worker/controller/native publication limits remain.

Raw parent logs remain local at `.audit/profile-controller-parent-focused.txt`, `.audit/profile-controller-final-verify-all.txt`, `.audit/profile-controller-actual-docker.txt`, and `.audit/profile-controller-docker-regressions.txt`. The [decision trail](decisions.tsv) records the choices that shaped this unit. Its timestamps record log writes, not exact event times; the retained transcript establishes ordering. React integration, protected-test reconciliation, other demonstration scenarios, M2 completion, and later human-presence gates remain open.
