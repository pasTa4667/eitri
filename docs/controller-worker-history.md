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

For explicitly enabled offline consumption, the controller retains a successful live worker return before callback delivery. Concurrent and repeated consumption share execution and retention. The synchronous transaction revalidates the original source and persisted journal binding. It appends facts once, accepts an exact duplicate without rewriting, and rejects a conflicting duplicate without overwriting it. It updates only the existing source row and never recreates a missing row.

Validation binds the complete original request, recomputed digests, acceptance ID, run ID, owner, configuration and actual execution interval. Endpoints must be nonnegative safe integers, with a positive interval no greater than the original request allowance. Safe actual endpoints do not require a safe hypothetical full-allowance endpoint. Acceptance timing remains separate. Recorded results and settled diagnostic or incomplete-cleanup results retain facts without conversion or evidence admission.

Forward authority compares the complete strictly parsed source except execution facts. Observation writes may finish after revocation, settlement or interruption if the original action, kind, frozen selection, intent and binding still match. They require no current epoch, surviving action row or remaining allowance. They do not restore execution authority. The final authority check can still deny callback delivery after facts commit.

Retention failure rejects consumption without replay. Scope drainage closes the journal and reports remembered retention failure. Controller close releases resources and reports failed drainage even if that drain completed before close started. Expected authority revocation alone does not fail closure.

Coverage is partial. A worker commit followed by a failed worker-side final authority check produces no successful return to this retention hook. A crash after worker commit but before controller commit can also leave facts absent. The two commits are not atomic. Legacy rows remain valid and unavailable, with no historical backfill. Both explicit source interruption reconstructions preserve retained facts.

## Read-only acquisition

`FrozenBrowserValidator.readHistoricalSelection(options)` selects by exact case, action, and epoch. It uses one existing-only historical acquisition and the existing record parsers. It guards files before returning a detached selection and closes privately.

The historical SQLite connection starts a read transaction before validation reads. Metadata, accounting, and records share that snapshot through the final file guard. The existing exact-selector `readConsumedReport` uses the same historical loader. Writable acquisition is unchanged.

The query performs no recovery, normalization, execution, cleanup, schema upgrade, accounting charge, converter call, artifact insertion, or native check admission. Controller startup remains separately recovery-capable. This query does not preserve pre-startup pending records against startup recovery.

## Ownership and closure

The controller holds its workspace queue through historical acquisition, selection, guard, and closure. Any registered worker consumption scope causes `worker-history-busy`, including lazy scopes and revoked scopes still draining. The query never waits for scope drainage under that queue.

Accepted reads are tracked through completion. Controller close drains them before closing catalogue and workspace storage. Reads admitted before close may finish. New reads reject after closing begins. Repeated close shares completion.

## Limits

Historical data alone does not establish independently retained execution facts. Controller-retained facts establish consistency relative to later history, not authorship, containment, current authority, executed cleanup, or daemon quiescence. Process-local ownership and file guards do not add cross-process exclusion or hostile same-UID protection.

The [consumed-report converter](consumed-admission.md) still requires independently pinned execution identity and timing. Retained observations expose controller-owned pins separately from history. Neither controller query calls the converter or admits a native check. Controller reopening still inventories the configured journal before recovery. Inspection without journal acquisition does not remove that startup dependency. Production main and HTTP wiring, complete admission capture, native real-check admission, actual fixture validation, and M2 acceptance remain separate work. No table or schema version changes are required. Downgrade compatibility with older strict source parsers is not promised.
