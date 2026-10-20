# Owned worker recovery inventory

## Selected unit

Implement non-executing inventory within the existing validator owner. This is the next prerequisite to durable controller-worker correlation, not complete correlation or dispatch.

| Alternative | Choice |
| --- | --- |
| A. Validator-owned reservation and inventory | Select inventory and journal-only opening. Defer reservation. |
| B. Controller-owned intent and association table | Reject this increment. It duplicates unresolved history before trusted worker identity can be recovered. |

The independent cross-judge agrees with A as the base. Graft B's distinction between historical records and current authority into the contract. Publishing a reservation without consumption would waste nonrefundable quotas. No graft of controller tables, handles or scheduler changes.

## Data shape

A detached RecoveryInventory contains owner identity, configuration digest, attempts, contribution and admission-ordered RecoveryRun records. Each run binds its exact persisted request, request digest, timing, build state and acquired resource states. A discriminated union separates recorded outcomes with unresolved cleanup from settled outcomes with historical cleanup. No nonce, raw evidence, screenshot, host path or new mutation method is exposed.

## API and invariants

FrozenBrowserValidator.open gains mode journal-only and returns a runtime-narrow handle with inventory and close. Existing execute-mode opening stays unchanged. Journal-only opening requires an existing complete owned directory, performs all existing validation, durably converts pending runs to recorded uncertainty, and skips finalize. It never calls Docker or borrowed WorkspaceStore. It does not create a run, change quota or deadline, settle cleanup or authorize controller evidence. Journal-only means no worker effects, not no SQLite recovery writes.

Inventory guards protected-file identities, returns detached snapshots, rejects after closing starts and drains accepted reads before close releases owner exclusion. Keep the exact two-table schema. No public reserve, imported report, cleanup, execution or interruption-clearing methods. Full controller-worker correlation, cancellation drainage and native real evidence remain open.

## Throughput checkpoint

- Blocking first steps. Completed grounding, two structurally distinct designs, rubric and independent cross-judge before edits. Parent baseline passes 554 Node and 30 Rust tests.
- Independent workstreams. Design output files are independent. Implementation is one isolated source owner. Review begins after its diff settles.
- Shared mutable state. Inventory, recovery and owner lifetime share the existing validator invariant. No concurrent source writers.
- Smallest safe decomposition. One writer changes only frozen-browser.ts, its focused public-interface tests and optional test child. Fresh reviews and parent verification follow.

## Review and verification

Use actual temporary SQLite and Git fixtures with a private Docker transcript or sentinel, never real Docker. Require literal nonempty inventory and a positive execution-mode sentinel control. Cover interrupted SIGKILL recovery, exact durable identity/accounting, unknown builds, acquisition states, success with incomplete cleanup, repeated inspection, invalid ownership/configuration/accounting, empty directories, detached nested values, runtime API restriction and close races. Preserve existing default-mode tests. The judge report lists detailed test cases.

No live gates, original fixture, worker assets, restrictions, project execution, dependencies, controller, native, HTTP or production main changes are authorized.
