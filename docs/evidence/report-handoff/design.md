# Selected offline report handoff

## Scope and data shape

Build opt-in consumed-report handoff through the existing run_check tool. Callback intent is a payload-free consumed-browser marker in a separate CheckCallbackResult union. Existing CheckExecution and simulated CheckResult retain their meanings. The internal host dispatch union adds controller-acquired FrozenBrowserConsumedReport. The model gains no new tool arguments and cannot select evidence.

## Synthesis

Candidate A is the base. Reuse post-drain FrozenBrowserValidator.readConsumedReport with the controller-retained exact key. The fresh cross-judge agrees. Graft candidate B's separate callback-result union and gated release verification. Reject B's new owned reader and unconditional closure snapshots because they alter non-handoff simulated behavior.

The controller observes fulfilled consumption, awaits cached closure outside workspaceSerial, preserves sticky failure and deterministic registry cleanup, captures fresh authority, queues exact historical retrieval and tracks it through shutdown, then returns a detached envelope. Native run_check routes it through recordConsumedBrowserCheck before action retirement. Unavailable native results use existing failed retirement. Tests must prove this prevents subsequent successful work, not infer it from a throw.

## Boundaries

One code owner handles src/domain.ts, src/controller.ts, src/native.ts and dedicated integration tests. Supporting test files may be added only when needed. No worker/journal API, main/HTTP activation, schemas, dependencies, containment, monitored fixture, secrets, live services, provider inference or remote operations.

## Verification

Exercise faux-provider run_check with actual temporary catalogue/native SQLite and scripted workers. Cover positive baseline/candidate receipts and literal PNG bytes, failed behavioral outcomes, blocked outcomes and retirement, strict marker parsing, missing consumption, fulfilled versus outstanding unawaited operations, failure drainage, release-before-retrieval, exact key selection, authority races and shutdown, reopening and simulated compatibility. Existing focused suites and npm run verify:all must pass. Fresh GPT correctness and comment audit must review final bytes before parent acceptance.

## Throughput checkpoint

Blocking first steps are complete grounding and two designs with cross-judge selection. Independent read-only design artifacts are complete. One writer owns shared source and tests. One owner is the smallest safe decomposition because action authority, drainage and native publication form one coupled seam. Reviews use separate artifacts and never mutate source.

## Delivery

Implement and verify locally. No remote is configured, so opening a PR is skipped. Keep documented non-atomic publication and crash boundaries. This establishes only offline handoff, not M2 acceptance or live cleanup/containment.
