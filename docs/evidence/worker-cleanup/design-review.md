# Cleanup design verdict

## Review

Recommend **Candidate B, the static operation**, as the base. It gives the worker owner one targeted cleanup command without a retained execution capability. The maintainer inherits fewer concurrency and closure states.

Reviewed both sketches and actual source against reviewer-launch HEAD `8bcbe025a270`. The working tree has no changes. This is a design review, not runtime verification. No source edits, tests, subprocesses, or Docker commands were performed.

throughput checkpoint: n/a, read-only investigation.

## Scores

Scores are design judgments out of 5, not measured results.

| Criterion | A. Cleanup-only opening | B. Static operation |
|---|---:|---:|
| Authority isolation and exact persisted selector | 4 | 5 |
| Crash, concurrency, and close safety | 4 | 5 |
| Idempotency and unchanged accounting | 5 | 5 |
| Minimal public and implementation complexity | 3 | 4 |
| Testability and truthful cleanup claims | 5 | 5 |
| **Total** | **21/25** | **24/25** |

B requires a careful loader extraction. A changes less opening machinery, but adds a mode, held capability, joining policy, operation slot, and close-drain behavior.

## Correct

- Both require an independently pinned owner/configuration and an exact acceptance/run/digest selector. Existing parsers bind the retained acceptance, nested request, owner, configuration, and shortened admission timing at `src/frozen-browser.ts:894-1047`.
- Both correctly reuse ownership-checked removal. Acquired identity is saved before deletion, and removal requires absence confirmation at `src/frozen-browser.ts:2929-2960`.
- Both preserve accounting and the original nested record. `saveNow()` locates the existing record and writes unchanged accounting at `src/frozen-browser.ts:1972-1995`.
- Both distinguish durable settlement from successful cleanup. Unknown builds remain incomplete at `src/frozen-browser.ts:2962-2995`.
- Neither proposal introduces native report admission. Native receipts still require `simulated === true` at `src/native.ts:492-513`.

## Material design blocker

### Finding P1. A performs non-target recovery writes before selection

Candidate A's **Opening remains non-reconciling** section preserves all-run pending normalization. Actual `open()` traverses every run, changes pending results to recorded uncertainty, and saves them before returning a restricted wrapper at `src/frozen-browser.ts:1832-1869`.

Consequently, opening cleanup-only and then submitting an invalid selector can already have changed unrelated pending records, including ordinary executions. This is not unauthorized execution or deletion. It is nevertheless broader than an exact-record recovery command.

The smallest correction is to separate validated acquisition from recovery traversal and normalize only the matched consumed record. B already specifies this boundary. Existing public opening modes should retain their current recovery behavior.

### Candidate B

No issues found.

Its loader extraction remains an implementation risk, not an evidenced design defect. Regression tests must prove unchanged ordinary and restricted opening behavior.

## Recommended exact contract

Use B's single static `FrozenBrowserValidator.reconcileConsumed(options)` operation.

1. Require `workspace`, `directory`, independently pinned `expectedIdentity`, and exact `consumedRun` fields `acceptanceId`, `runId`, and `requestDigest`. Snapshot and validate inputs before awaiting.
2. Acquire existing storage under the current ownership mechanism. Do not provision a journal or traverse recovery states.
3. Match only one persisted `consumed-acceptance`. Match both selector identifiers and the digest against its retained acceptance and nested execution. Invalid selection causes no application recovery writes or Docker calls. SQLite hot-journal recovery remains an explicit exception to byte-level immutability.
4. Normalize only selected pending consumption to recorded uncertainty with null evidence. Never execute it.
5. Retry the existing finalizer for recorded or settled-incomplete cleanup. Return settled-success history without Docker calls or another write.
6. Preserve acceptance, request, admitted timing, outcome, evidence, acquisition history, accounting, metadata version, and all unrelated logical rows.
7. Hold ownership through reconciliation, queued persistence, database closure, and release. Resolve only after closure. Reject concurrent same-directory ownership attempts, including exact duplicates. Add no joining mechanism.
8. Return detached `{ acceptanceId, run }` with a settled recovery run. Incomplete cleanup fulfills only after persistence. Persistence uncertainty rejects and prevents success acknowledgment.

Both designs inherit process-local ownership, not cross-process exclusion. Deployment must exclude surviving independent owners. Neither successful settlement nor close proves daemon quiescence or cache reclamation.

## Grafts and verification gates

Graft A's explicit queue-deadlock warning into B's implementation constraints. Never await `finalize()` inside `journalQueue`, because finalization itself awaits queued saves at `src/frozen-browser.ts:1942-1945,2954-2955,2994-2995`.

Use A's detailed persistence and drainage checkpoints, adapted to B's private lifetime. Gate acquisition, removal, and final save. Verify ownership remains held until closure, including failure paths. Test immediate input mutation, acquired-ID save failure, removal-before-settlement crashes, and successful retries with zero worker calls.

Do not graft A's public mode, held inventory capability, duplicate joining, or reconciliation slot.

After implementation, run the focused synthetic cleanup suite and `npm run verify`. These checks do not establish live daemon cleanup.

## Principles applied

- **Laziness Protocol** favored B's single command over another held lifecycle.
- **Model the Domain** favored an immutable consumed selector and settled-only result.
- **Make Operations Idempotent** required crash retries without replay, recharging, or renewed execution authority.

**Merge verdict.** OK with notes for B as the implementation base. BLOCK A as written under the exact-record mutation contract. Neither sketch constitutes implementation approval.