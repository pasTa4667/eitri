# Targeted consumed-run cleanup

## Synthesis

Implement Candidate B, a static FrozenBrowserValidator.reconcileConsumed(options) operation. Candidate A would normalize unrelated pending rows before target selection. The GPT cross-judge identified that mismatch. The static command avoids it and avoids another held capability, operation slot, duplicate joining policy, or close state.

Caller supplies workspace, directory, independently pinned expectedIdentity, and consumedRun containing acceptanceId, runId, requestDigest. Return detached acceptanceId and a settled RecoveryRun. Settlement can retain incomplete cleanup.

Extract effect-free existing-journal acquisition without changing public opening recovery semantics. Snapshot exact input before awaits. Bind target to a consumed-acceptance record before application recovery writes or Docker calls. SQLite hot-journal recovery remains possible. Normalize only a selected pending execution to recorded uncertainty and null evidence. Use existing finalizer for recorded or incomplete records. Return historical successful settlement without writes or Docker calls. Preserve every other logical row, original acceptance/request/timing/outcome/evidence, accounting and schema version.

Hold existing process-local ownership through persistence and private close. Concurrent same-directory commands reject, including duplicates. No new cross-process exclusion claim. Never await finalization within journalQueue, because finalization queues saves. No execution, replay, evidence export, controller/native integration, production wiring, original fixture mutation, credentials, live services, inference, publication, deployment, or containment changes.

## Throughput checkpoint

- Blocking first steps. Completed read-only grounding, two structural sketches and GPT cross-judgment. Runtime authority gates stay closed.
- Independent workstreams. One coupled worker journal source seam has one implementation owner. Parent verification and fresh GPT reviews follow implementation.
- Shared mutable state. Isolated implementation worktree. Existing journal ownership excludes overlapping in-process users. No new shared durable state.
- Smallest safe decomposition. First preserve loading/opening behavior, then add the exact-record command and focused tests. Verify each unit before the next.

## Acceptance

Focused scripted tests must cover exact selectors, independent pins, input mutation, passive restricted modes, non-target logical row preservation, no workspace use, no replay, unchanged accounting, unresolved ownership, idempotent retries, persistence failures, ownership retention and actual subprocess interruption. Full verify:all must finish with adequate timeout. Keep test output in .audit and report actual scope. Real Docker cleanup is not claimed by transcript fixtures.
