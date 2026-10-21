# Controller historical worker correlation

`Controller.inspectWorkerConsumedHistory(caseId, actionId)` correlates one retained controller intent with historical worker records. It is an offline library query. Production main and HTTP do not expose it.

## Retained attribution

The controller selects the original request and digest from its validated action source. Its configured journal binding supplies the directory, owner ID, and configuration digest. The query does not substitute the current action, epoch, revision, or allowance.

Missing or malformed sources retain existing validation errors. A valid source without worker intent returns `unrecorded` without journal acquisition.

## Historical results

The result is a discriminated union.

- `unrecorded` means the valid action source has no worker intent.
- `absent` means a validated historical snapshot contains no record for the original case, action, and epoch.
- `conflict` means the complete request, digest, or configuration differs, or a matching record is a legacy direct execution.
- `accepted-unconsumed` contains the matching historical acceptance without an execution.
- `consumed` contains the matching historical acceptance and its `pending`, `recorded`, or `settled` history. Only settled history contains a report.

Request mismatch takes precedence over legacy execution classification. Another action or epoch is not a match. Missing storage, foreign identity, corruption, rollback sidecars, ownership contention, and closure failures reject rather than returning `absent`.

Acceptance and consumed history carry `provenance: 'worker-journal'`. Their IDs and actual timestamps are journal-derived. The result explicitly marks independent execution pins as unavailable because the controller does not retain them.

The original request allowance remains unchanged beside the historical actual execution interval. Acceptance timing is distinct from execution timing. Settled diagnostic outcomes, null evidence, and incomplete cleanup remain historical data.

## Read-only acquisition

`FrozenBrowserValidator.readHistoricalSelection(options)` selects by exact case, action, and epoch. It uses one existing-only historical acquisition and the existing record parsers. It guards files before returning a detached selection and closes privately.

The historical SQLite connection starts a read transaction before validation reads. Metadata, accounting, and records share that snapshot through the final file guard. The existing exact-selector `readConsumedReport` uses the same historical loader. Writable acquisition is unchanged.

The query performs no recovery, normalization, execution, cleanup, schema upgrade, accounting charge, converter call, artifact insertion, or native check admission. Controller startup remains separately recovery-capable. This query does not preserve pre-startup pending records against startup recovery.

## Ownership and closure

The controller holds its workspace queue through historical acquisition, selection, guard, and closure. Any registered worker consumption scope causes `worker-history-busy`, including lazy scopes and revoked scopes still draining. The query never waits for scope drainage under that queue.

Accepted reads are tracked through completion. Controller close drains them before closing catalogue and workspace storage. Reads admitted before close may finish. New reads reject after closing begins. Repeated close shares completion.

## Limits

Historical correlation does not establish independently retained execution facts, authorship, containment, current authority, executed cleanup, or daemon quiescence. Process-local ownership and file guards do not add cross-process exclusion or hostile same-UID protection.

The [consumed-report converter](consumed-admission.md) still requires independently pinned execution identity and timing. The controller query does not manufacture those expectations from its own historical result. Durable execution-fact retention, native real-check admission, actual fixture validation, and M2 acceptance remain separate work.
