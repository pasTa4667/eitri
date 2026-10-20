# Worker correlation cross-judge

## Judgment

Select A as the base. Ship only its non-executing recovery inventory and journal-only opening. Defer public `reserve` and its executor extraction.

Graft B's distinction between historical claims and current authority into the contract and tests. Do not graft B's controller table, callback handle, quotas, or Continue/Retry changes.

This is concrete and sufficient as the next bounded prerequisite. It provides useful owned-journal recovery without effects. It does not complete controller correlation.

The requested external artifact write was blocked by the workspace restriction. This complete report is returned for runtime persistence to the authoritative path.

throughput checkpoint: n/a, read-only investigation

## Scores

Scores grade the submitted designs. Five is strongest. They are judgments, not measured results. There is no averaged winner.

| Criterion | A | B | Judgment |
| --- | --- | --- | --- |
| Durable-before-effect identity | 5 | 2 | A exposes identity committed by the validator owner. B exposes an independent intent UUID and explicitly cannot recover the worker UUID in the missing-report window. |
| Conservative crash/cleanup semantics | 4 | 4 | Both reject replay and preserve uncertainty. A retains the actual resource ledger. B retains claims and blocks interruption indefinitely without trusted reconciliation. |
| Narrow API depth | 3 | 2 | A reuses ownership and schema but publishes an unusable reservation lifecycle. B adds configuration, persistence, handles, late writes, limits, and scheduler policy without owned run discovery. |
| Compatibility with accepted boundaries | 4 | 3 | A expands validator admission unnecessarily. B preserves simulated-only evidence but changes controller policy around unauthenticated cleanup claims. |
| Rerunnable behavioral checks | 4 | 4 | Both specify public-API and crash checks. Neither ran them. Both need concrete fixtures and positive controls for absence assertions. |

A wins on ownership. B's controller-only independence does not justify adding another unresolved history before the owning journal is safely inspectable.

## Evidence

I read both design files completely and both source files completely, including truncated continuations.

`git rev-parse --short HEAD` returned `d932d8c`. `git status --short` showed only the pre-existing unstaged `decisions.tsv` change. I did not touch it.

- `src/frozen-browser.ts:140-166` puts run identity, digests, ownership, timing, accounting reservation, acquisition state, and result in the validator journal.
- `src/frozen-browser.ts:256-257` keys admission by case/action/epoch. `validate` at 1597 rejects changed full requests under that key.
- `src/frozen-browser.ts:1740-1775` allocates and commits run identity and accounting before frozen reads or Docker work. Pre-effect identity already exists internally.
- `src/frozen-browser.ts:1507-1525` converts pending runs to recorded uncertainty and calls `finalize` during opening. Ordinary `open` is therefore not inert inspection.
- `src/frozen-browser.ts:2215-2277` verifies owned resources before removal and records cleanup separately from outcome. Unknown builds remain unresolved.
- `src/frozen-browser.ts:502-505` explicitly states that converter consistency does not establish authorship, containment, or executed cleanup.
- `src/controller.ts:454-619` owns action-scoped source selection and interruption. Lines 998-1184 own permission, post-callback checks, revocation, and settlement. These do not establish validator ownership.
- `src/controller.ts:1377-1466` conservatively recovers interrupted tool effects. Its broad native-storage catch complicates B's integration. Details expiry at 1468-1514 is not worker cleanup.
- `docs/check-execution.md` keeps receipts simulated, the validator unwired, and cancellation distinct from drainage.

## Why defer reserve

A's public reservation consumes one of 16 lifetime attempts and 40 MiB of nonrefundable contribution. No public method consumes it. Existing `validate` rejects the unsettled identity. Reopening converts it to uncertain interrupted work.

That behavior is conservative but not useful enough to publish now. It introduces a permanent admission effect before the authority handoff that would make it useful.

Do not compensate through refunds, weaker deduplication, or implicit consumption by `validate`. Those change accepted crash semantics and require the deferred authority decision.

Inventory-only opening creates no run, consumes no quota, and needs no reservation admission queue. It closes the immediate recovery gap without claiming atomicity between owners.

## Minimal API

Keep this within the existing validator owner. Reuse its validation and directory-owner exclusion.

```ts
type JournalResource =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'intent' }>
  | Readonly<{ kind: 'acquired'; id: string }>;

type RecoveryRun = Readonly<{
  runId: string;
  request: FrozenBrowserRequest;
  requestDigest: Sha256;
  configurationDigest: Sha256;
  admittedAt: number;
  deadline: number;
  build: 'not-started' | 'unknown' | 'completed';
  image: JournalResource;
  container: JournalResource;
}> & (
  | Readonly<{
      state: 'recorded';
      outcome: FrozenBrowserOutcome;
      cleanup: 'unresolved';
    }>
  | Readonly<{
      state: 'settled';
      outcome: FrozenBrowserOutcome;
      cleanup: FrozenBrowserCleanup;
    }>
);

type RecoveryInventory = Readonly<{
  ownerId: string;
  configurationDigest: Sha256;
  attempts: number;
  contribution: number;
  runs: readonly RecoveryRun[];
}>;

type FrozenBrowserJournal = Readonly<{
  inventory(): Promise<RecoveryInventory>;
  close(): Promise<void>;
}>;

// New overload. Preserve the existing execute-mode signature.
static open(options: {
  directory: string;
  workspace: WorkspaceStore;
  mode: 'journal-only';
}): Promise<FrozenBrowserJournal>;
```

This is a proposed signature, not implemented code. Parse UUIDs, hashes, requests, resource IDs, outcomes, and cleanup through existing boundary validators. Branded owner/run IDs may improve signatures but do not grant authority.

Retain the borrowed workspace dependency to avoid unrelated constructor extraction. Journal-only mode must never invoke it.

No separate `inspect(expected)` is necessary for at most 16 runs. Inventory exposes the owner and complete saved request. A future caller can compare its independently persisted expectation. No nonce, screenshots, report-writing method, or cleanup capability is needed.

### Invariants

1. Journal-only open requires an existing owned journal. Empty or missing journals fail without initializing files, owner identity, or schema.
2. Reuse current marker, inode, policy, configuration, schema, digest, committed-evidence, uniqueness, and accounting validation. Do not weaken checks for inspection.
3. Preserve A's existing pending-to-recorded recovery transition. Persist `uncertain/interrupted-run-no-replay` with null evidence before returning the handle.
4. This is journal-only, not filesystem-read-only. Recovery writes and SQLite hot-journal recovery remain possible.
5. Skip `finalize`. Open, inventory, and close invoke no Docker, worker execution, workspace reads, or resource cleanup.
6. Enforce the restriction at runtime. Prefer a narrow returned object with no `validate` method, rather than only a narrow TypeScript type.
7. Inventory never allocates identities, charges/refunds quota, renews timing, changes acquisition ledgers, or settles cleanup.
8. Recorded results expose unresolved cleanup even with empty resource ledgers. Settled cleanup is historical, not a fresh daemon assertion.
9. Preserve unknown builds and every acquisition intent/ID exactly. Expired deadlines and behavioral success do not establish cleanup.
10. Return detached snapshots in durable admission order. Repeated inspection converges after interrupted-state recovery.
11. Retain owner exclusion through close completion. Guard reads against protected-file replacement. Reject calls after closing starts and drain reads admitted beforehand.
12. Preserve the two-table schema and all default execute-mode admission, recovery, accounting, cancellation, deduplication, and cleanup behavior.
13. Change no controller, native, HTTP, worker, or evidence-admission behavior.

## Exact acceptance requirements

These are requirements for implementation. No project tests or execution occurred during this review.

1. **Literal inventory.** Open an existing trusted fixture containing recorded, interrupted, settled-clean, and settled-incomplete runs. Assert the entire inventory, including owner, IDs, requests, timestamps, digests, accounting, acquisition state, outcomes, cleanup, and ordering.
2. **Interrupted recovery.** Kill a child with a committed pending run. Journal-only reopen must preserve identity, timing, ledger, and accounting. Assert recorded uncertainty with the exact interruption code and unresolved cleanup. Reopen twice and compare literal inventories. Verify null durable evidence.
3. **No effects.** Run journal-only operations with a Docker sentinel executable that would log invocations and fail. Assert a nonempty expected inventory and no invocation log. Include an execute-mode fixture control that demonstrably reaches the sentinel. The sentinel is not real Docker. A borrowed workspace stub that fails on every method must not prevent inventory.
4. **Cleanup matrix.** Cover unknown build, image intent, acquired image, container intent, acquired container, recorded success, settled-incomplete success, and settled-clean history. Assert exact ledger preservation and cleanup interpretation.
5. **Recovery durability.** Kill during pending recovery persistence. Reopen must find either the original pending record subsequently recovered or the committed recorded result. Never allow new identity or partial accounting. Inject save failure and require rejection before a handle escapes.
6. **Integrity.** Independently corrupt schema, row digest, marker, protected-file identity, configuration, request digest, action-key uniqueness, run-ID uniqueness, and accounting. Require existing fail-closed errors and no fresh journal replacement.
7. **Existing-only opening.** Empty-directory and missing-file cases fail without initialized ownership or schema.
8. **Detached snapshots.** Mutate returned nested requests, ledgers, cleanup, and arrays. Subsequent inventory and reopen must retain the original literal values.
9. **Lifecycle.** Race inventory with close. Accepted reads complete; later reads reject. Repeated close converges. A second owner remains excluded until release. Protected-file replacement after opening makes inventory fail.
10. **API restriction.** Type tests reject execution/reservation/report-writing access. Runtime tests show that casting the returned handle cannot recover an execution method.
11. **Regression.** Preserve default validator/admission tests and controller check/workspace tests. Cover simulated-only receipts, pause precedence, late old-epoch rejection, source recovery, and details expiry without new controller semantics.
12. **Delivery.** Add focused tests under the existing `npm test` glob. Run `npm run verify` on Node 26.5.0 and record fault boundaries and results. Real Docker acceptance is neither required nor established by this unit.

Use trusted synthetic journal fixtures or test-only child setup. Do not add production arbitrary-report or journal-import APIs. An absence assertion alone is insufficient; pair it with literal recovered data and an observation control.

## Limits and authority boundary

The owning journal attests locally persisted identity within the existing trusted-owner model. It does not establish current controller permission, live daemon state, malicious same-UID resistance, cryptographic authorship, or power-loss durability.

Keeping current configuration validation means this is not an archive reader across configuration upgrades.

Later work still needs:

- A persisted controller-to-validator-owner association.
- An authority-aware handoff that cannot renew allowance.
- Treatment of the admission commit/acknowledgment gap.
- Cancellation drainage and trusted cleanup reconciliation.
- Retry and evidence gates tied to unresolved owned work.

Inventory does not implement those guarantees.

No irreducible authority decision blocks this bounded increment. Stop if implementation expands into reservation consumption, interruption clearing, post-timeout admission, or native evidence. Those require a separate authority decision.

## Principles applied

I read each named principle's leaf skill completely.

- **Laziness Protocol** removed public reserve and B's additional history rather than adding an unusable lifecycle.
- **Sequence Work into Verifiable Units** separated inspectable recovery from execution-authority handoff.
- **Test Behavior, Not Implementation** required literal inventory assertions and positive sentinel controls instead of source inspection or absence alone.