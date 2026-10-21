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

Acceptance and consumed history carry `provenance: 'worker-journal'`. Their IDs and actual timestamps are journal-derived. `independentExecutionPins` separately projects controller-retained facts, or reports `not-retained-by-controller`. Historical selection never supplies or repairs these facts. The controller validates retained facts before selecting history, so absent or conflicting history cannot conceal malformed controller data.

The original request allowance remains unchanged beside the historical actual execution interval. Acceptance timing is distinct from execution timing. Settled diagnostic outcomes, null evidence, and incomplete cleanup remain historical data.

## Controller-retained live execution facts

`Controller.inspectWorkerExecutionFacts(caseId, actionId)` is a synchronous controller-storage-only query. It does not acquire the worker journal. A valid source without intent returns `unavailable` with `no-worker-intent`. Intent without retained facts returns `unavailable` with `not-retained-by-controller`. Malformed facts reject with `invalid-worker-execution-facts` rather than becoming unavailable.

A retained result has `provenance: 'controller-live-consumption'`, the original intent, the version-1 journal binding, and `facts`. The facts contain only `consumedRun: { acceptanceId, runId, requestDigest }`, `admittedAt`, and `deadline`. All returned data is detached.

For explicitly enabled offline consumption, the controller retains each new live admission after the worker commit and before execution or frozen reads. The synchronous observer receives detached acceptance, consumed-run identity, and actual interval. Concurrent and repeated scope consumption share execution and retention. The synchronous transaction revalidates the original source and persisted journal binding. It appends facts once, accepts an exact duplicate without rewriting, and rejects a conflicting duplicate without overwriting it. It updates only the existing source row and never recreates a missing row.

Validation binds the complete original request, recomputed digests, acceptance ID, run ID, owner, configuration and actual execution interval. Endpoints must be nonnegative safe integers, with a positive interval no greater than the original request allowance. Safe actual endpoints do not require a safe hypothetical full-allowance endpoint. Acceptance timing remains separate. Admission facts do not establish that execution began or completed. Later diagnostic outcomes, incomplete cleanup, or denied delivery do not remove retained facts.

Forward authority compares the complete strictly parsed source except execution facts. Observation writes may finish after revocation, settlement or interruption if the original action, kind, frozen selection, intent and binding still match. They require no current epoch, surviving action row or remaining allowance. They do not restore execution authority. The final authority check can still deny callback delivery after facts commit.

Retention failure rejects consumption before execution, result recording, or cleanup. The worker's charged pending admission remains committed. The scope caches rejection without retrying retention or execution. Scope drainage closes the journal and reports remembered retention failure. Controller close releases resources and reports failed drainage even if that drain completed before close started. Expected authority revocation alone does not fail closure.

The worker and controller commits are not atomic. A crash between them can leave facts absent beside charged worker history. A later authority rejection does not suppress observation of an already committed live admission. Existing pending consumption rejects without replay. Existing recorded or settled consumption returns history without notifying the observer. Legacy rows remain valid and unavailable, with no historical backfill. Both explicit source interruption reconstructions preserve retained facts.

## Read-only acquisition

`FrozenBrowserValidator.readHistoricalSelection(options)` selects by exact case, action, and epoch. It uses one existing-only historical acquisition and the existing record parsers. It guards files before returning a detached selection and closes privately.

The historical SQLite connection starts a read transaction before validation reads. Metadata, accounting, and records share that snapshot through the final file guard. The existing exact-selector `readConsumedReport` uses the same historical loader. Writable acquisition is unchanged.

The query performs no recovery, normalization, execution, cleanup, schema upgrade, accounting charge, converter call, artifact insertion, or native check admission. Controller startup remains separately recovery-capable. This query does not preserve pre-startup pending records against startup recovery.

## Ownership and closure

The controller holds its workspace queue through historical acquisition, selection, guard, and closure. Any registered worker consumption scope causes `worker-history-busy`, including lazy scopes and revoked scopes still draining. The query never waits for scope drainage under that queue.

Accepted reads are tracked through completion. Controller close drains them before closing catalogue and workspace storage. Reads admitted before close may finish. New reads reject after closing begins. Repeated close shares completion.

## Controller consumed-report conversion

`Controller.inspectWorkerConsumedAdmission(caseId, actionId)` composes the historical query with `admitFrozenBrowserConsumedReport`. Its exported `WorkerConsumedAdmissionObservation` preserves nonconsumed members unchanged. Consumed members add a correlated `conversion` member.

- `not-settled` contains pending or recorded history. This state takes precedence even when independent pins are unavailable.
- `independent-pins-unavailable` contains settled history without controller-retained facts. The original unavailable reason remains visible.
- `converted` contains settled history, retained pins, and a `FrozenBrowserAdmission`. Both behavioral and blocked results return normally.

The expectation uses only the captured independent pins' original intent, binding configuration digest, consumed-run selector, and actual interval. The original request role selects baseline or browser conversion. The converter receives `history.value`, not the provenance wrapper. Original allowance and attribution survive later edits, Retry, and controller reopening. The query does not backfill unavailable pins or consult current authority.

The historical call captures inputs immediately, before queued acquisition. Conversion runs after successful historical guard and closure, outside the workspace queue. The controller synchronously tracks the outer promise through projection, so immediate close drains accepted conversion work too. Busy-scope rejection and historical validation errors propagate unchanged. Converter inconsistencies reject with `invalid-frozen-browser-admission`. Inspection rejection does not independently fail controller close.

Returned history, pins, reports, and decoded PNG bytes are detached. The query performs no execution, cleanup, clock reads, writes, artifact insertion, or native check admission. Production main and HTTP do not expose it.

## Limits

Historical data alone does not establish independently retained execution facts. Controller-retained facts establish consistency relative to later history, not authorship, containment, current authority, executed cleanup, or daemon quiescence. Process-local ownership and file guards do not add cross-process exclusion or hostile same-UID protection.

The [consumed-report converter](consumed-admission.md) requires independently pinned execution identity and timing. Retained observations expose controller-owned pins separately from history. The raw history and facts queries do not call the converter. The consumed-admission query composes them from one captured historical observation without admitting a native check. Controller reopening still inventories the configured journal before recovery. Inspection without journal acquisition does not remove that startup dependency. Production main and HTTP wiring, complete admission capture, native real-check admission, actual fixture validation, and M2 acceptance remain separate work. No table or schema version changes are required. Downgrade compatibility with older strict source parsers is not promised.
