# Historical consumed-report retrieval

## Query

`FrozenBrowserValidator.readConsumedReport(options)` reads retained history for one consumed acceptance. It returns detached data, not current execution authority, a native check receipt, or a live cleanup assertion.

The options contain these fields.

- `directory` identifies an existing worker journal.
- `expectedIdentity` independently pins `ownerId` and `configurationDigest`.
- `consumedRun` contains exactly `acceptanceId`, `runId`, and `requestDigest`.

The query captures these values before asynchronous work. It matches the acceptance and nested execution identities. An ordinary execution, unconsumed acceptance, missing target, or mixed selector rejects. No workspace dependency or public journal handle is required.

## Historical states

`FrozenBrowserConsumedReport` contains the exact `consumedRun`, actual `admittedAt` and `deadline`, and one state.

- `pending` returns no report. Retrieval does not normalize it into uncertainty.
- `recorded` returns no report. Retrieval does not settle or finalize it.
- `settled` returns the retained `FrozenBrowserReport`, including null evidence or incomplete cleanup when present.

The original request allowance remains unchanged. Actual consumed timing can be shorter. Retained evidence keeps that shortened deadline. The query does not rewrite timing to satisfy `admitFrozenBrowserReport()`, whose ordinary full-allowance checks remain unchanged.

## Storage and ownership

Retrieval uses existing-only, read-only SQLite access. It validates schema, accounting, independent identity, all retained records, and committed evidence through the existing versioned parsers. Unrelated corrupt records reject the query. Legacy journals are validated without upgrades and cannot supply a consumed target.

Any rollback sidecar prevents retrieval, including a cold sidecar. The query does not recover or delete it. Existing worker opening retains its separate recovery behavior.

Retrieval guards retained files and holds process-local directory ownership until private closure. Concurrent retrieval, cleanup, and worker opening for that directory reject. Success and failure release ownership through private closure. Results do not share mutable objects with the retained journal.

The query performs no application recovery writes, normalization, cleanup, execution, workspace access, accounting charge, schema upgrade, or provisioning. Exhausted execution quota does not prevent historical reads.

## Limits

Independent identity pins must come from trusted configuration or association, not discovery from the journal being queried. Retained integrity does not establish current controller authority or current daemon state. Existing trusted-owner and same-UID limitations remain. No cross-process locking guarantee is added.

This is an offline worker library query. Production main, native real-check admission, actual fixture validation, and M2 acceptance remain separate work. Temporary-journal tests use scripted external effects, not live Docker containment evidence. The [verification record](evidence/worker-reports/verification.md) records executed checks and review limits.
