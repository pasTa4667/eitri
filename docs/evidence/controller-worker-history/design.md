# Controller historical correlation cross-judge

The artifact write was blocked because the authoritative path is outside the working directory. This report is returned for runtime persistence at:

`/Users/felix.langbein/.pi/agent/sessions/--Users-felix.langbein-projects-eitri--/subagent-artifacts/outputs/a74bcd71-cbd2-48c4-ae24-b860a308cb2c/.audit/controller-report-design-judge.md`

## Decision

Choose A's action-only query. Graft B's existing missing-source rejection. Include A's bounded historical read transaction.

Neither design should ship unchanged.

The caller needs correlation between retained controller intent and one validated worker-history observation. A caller-supplied execution selector does not strengthen independent attribution. The controller does not retain that selector independently, and B explicitly leaves its run ID unverified for unconsumed acceptance.

Read both complete designs, `controller-report-design-a.md` and `controller-report-design-b.md`, from the supplied artifact directory. Inspected relevant source at `9500610`. Repository status was clean. No source edits, tests, workers, or subagents ran.

throughput checkpoint: n/a, read-only investigation

## Scores

Scores are judgments on a five-point scale, not measurements. Criteria have equal weight.

| Criterion | A | B | Judgment |
| --- | --- | --- | --- |
| Independent retained request attribution and honest provenance | 5 | 4 | Both distinguish intent from historical execution facts. B's selector remains an unauthenticated caller claim. |
| Strict read-only query and coherent validated observation | 5 | 4 | Both use historical acquisition. A additionally closes the separate-SQL-snapshot gap. |
| Controller close, queue, and scope lifetime | 5 | 5 | Both correctly hold the queue through closure and reject registered scopes. |
| Smallest useful API | 4 | 2 | A needs no unretained selector. Its source-missing helper is unnecessary. B adds caller storage and selector validation without stronger evidence. |
| Behavioral testability and existing contracts | 4 | 4 | Both have strong test plans. A changes missing-source behavior unnecessarily. Its transaction also requires updating an existing SQL instrumentation assertion. |
| Total | 23/25 | 19/25 | Choose A with the grafts below. |

B correctly rejects inventory discovery followed by converter admission. That is not a blocker for A. A discovers IDs inside one read-only parsed observation and labels them historical. Neither design should construct converter expectations.

## Chosen contract

Use A's controller signature.

```ts
inspectWorkerConsumedHistory(
	caseId: string,
	actionId: string,
): Promise<WorkerConsumedHistoryObservation>;
```

Keep A's result structure with one reduction.

- `unrecorded` is exactly `{ state: 'unrecorded' }`. A valid source exists without worker intent.
- `absent` contains the detached retained `intent`.
- `conflict` contains `intent`, `reason`, and historical `observed`. Reasons are `request-mismatch` and `legacy-execution`.
- `accepted-unconsumed` contains `intent`, historical `acceptance`, and unavailable independent execution pins.
- `consumed` contains `intent`, historical `acceptance`, historical `history`, and unavailable independent execution pins.

Keep A's `Historical<T>` wrapper with `provenance: 'worker-journal'`. Keep its pin marker:

```ts
{
	state: 'unavailable',
	reason: 'not-retained-by-controller',
}
```

Reuse `FrozenBrowserConsumedReport` unchanged. Pending and recorded states have no report. Settled diagnostic outcomes, null evidence, and incomplete cleanup remain historical data, not admitted successful checks.

A full-request mismatch takes precedence over `legacy-execution`. Different case, action, or epoch keys yield `absent`. Wrong journal identity, corruption, unavailable storage, ownership contention, rollback sidecars, and closure failures reject.

### Preserve source validation

Use `source(caseId, actionId)` directly before asynchronous work. Remove A's source-existence helper and both unrecorded reason strings.

`source()` reads the action-source row before calling `this.get(id)` at `src/controller.ts:557-588`. Therefore:

- Missing rows retain `action-source-missing`.
- Foreign-case and malformed sources retain existing validation failures.
- Do not introduce a new case-existence lookup or promise `case-not-found` precedence when the source is missing.
- Only a valid source without intent returns `unrecorded`, without worker I/O.

This is the useful graft from B.

### Preserve provenance

Independent controller facts are the original retained request, its digest, and configured journal identity.

Acceptance ID, execution run ID, and actual worker timing remain journal-derived. Never sample current allowance, substitute the current epoch, or treat acceptance timing as execution timing. Never construct `FrozenBrowserConsumedExpectation`.

## Exact minimal implementation seam

### Worker read

Add A's narrow static method in `src/frozen-browser.ts`.

```ts
FrozenBrowserValidator.readHistoricalSelection({
	directory,
	expectedIdentity,
	action: { caseId, actionId, epoch },
}): Promise<HistoricalWorkerSelection | null>;
```

Use A's selection union.

- `legacy-execution` exposes request, request digest, configuration digest, and run ID.
- `accepted-unconsumed` exposes acceptance.
- `consumed` exposes acceptance and the existing consumed-history projection.

Implementation boundaries:

1. Copy and validate the action key and expected identity before the first await.
2. Acquire once through private `acquireJournal`, using `storage: 'existing-only'` and `historical: true`.
3. Select by exact action tuple through existing `recordRequest`.
4. Build acceptance and execution selector from that same parsed record.
5. Guard every successful semantic result, including null, legacy, and unconsumed.
6. Detach the result and close in `finally` before resolving.

Selecting by digest would conceal a same-key request mismatch as absence. Do not do that.

Reuse `acknowledgment`. Extract only the small consumed-history projection shared with `readConsumedReport`. Keep parsing, inventory, and recovery logic private. Do not expose a journal handle or introduce a read-session API.

The historical closer is synchronous, `HistoricalJournal.close(): void` at `src/frozen-browser.ts:248-252`. Keep it synchronous. Its existing `finally` releases ownership if database closure throws.

### Historical `BEGIN`

Include a conditional `BEGIN` on the historical read-only connection.

Place it after `PRAGMA trusted_schema=OFF` and before the first database-reading validation, including integrity, page-size, and schema checks. Retain it through metadata and run loading, parsing, selection, and the final guard. Connection closure ends the read transaction.

Do not use `BEGIN IMMEDIATE`. Do not change writable acquisition.

This is a necessary bounded improvement for the chosen coherent-observation guarantee, not scope creep.

`acquireJournal` currently reads metadata and run rows through separate SQL statements at `src/frozen-browser.ts:2050-2100`. The process-local owner set does not exclude another process. `guardJournalFiles` checks identity and selected file contents, not an immutable database version. One acquisition alone does not guarantee one SQLite snapshot.

A read transaction creates no durable inventory or recovery writes. Keep rollback-sidecar rejection before opening and at the final guard. Concurrent external activity may cause rejection.

The bounded guarantee is one validated SQLite snapshot under existing ownership and file guards. It is not cross-process exclusivity, hostile same-UID protection, or current daemon state.

The shared historical loader also serves `readConsumedReport`. Its selector, result shape, and rejection semantics remain unchanged. However, an existing test explicitly expects only PRAGMA exec calls in `test/frozen-browser-consumed-report.test.ts`. Update that instrumentation assertion to include `BEGIN`. Do not promise that every existing test remains textually unchanged.

### Controller ownership

Place the tracking wrapper and private implementation beside `inspectWorkerAssociation` in `src/controller.ts:394-438`.

1. Validate IDs and reject closing.
2. Copy the configured binding and validate and detach retained intent before the first await.
3. Return `unrecorded` without worker acquisition when intent is absent.
4. Enqueue one `workspaceSerial` callback covering acquisition, selection, guard, and closure.
5. Inside that callback, reject `worker-history-busy` whenever `workerScopes.size !== 0`.
6. Call the worker reader once and compare complete request, recomputed digest, retained digest, stored digest, and configuration identity.
7. Return the detached historical observation.

Widen existing `workerInspections` to `Set<Promise<unknown>>`. Track the complete operation synchronously. Reuse the existing `finally(...).catch(() => {})` removal pattern. Do not add B's separate history-read set.

The busy policy includes lazy scopes, acquiring scopes, held journals, and revoked scopes still draining. Never await scope drainage while holding `workspaceSerial`.

A scope registered after the busy check can only open through the same queue, behind historical closure. A previously queued opener runs first, and its registered scope then causes busy rejection. These rules require no `WorkerExecutionScope` changes.

`workspaceSerial` rejects new admission after closing but permits already queued callbacks to run. Do not add a second closing check inside an admitted callback. Do not split the query across later queue submissions.

`drainClose` already waits for `workspaceQueue` and `workerInspections` before workspace and catalogue closure at `src/controller.ts:2000-2013`. Reuse that order.

Preserve these behaviors:

- Queries admitted before close may finish.
- Later queries reject `controller-closed`.
- Repeated close returns the same promise.
- Query rejection alone does not make controller close fail.
- Closure failure rejects the query and still releases process-local ownership.

## Grafts and verification

Keep from A:

- Action-only caller inputs.
- Exact-key worker selection.
- Historical provenance and unavailable independent pins.
- Shared consumed-history projection.
- Busy policy and existing tracking-set reuse.
- Historical read transaction.

Graft from B:

- Direct `source()` validation.
- Existing missing-source rejection and validation ordering.

Reject:

- B's caller selector and separate tracking set.
- A's source-existence helper and expanded missing-source taxonomy.
- Any inventory-plus-report composition.
- Any converter expectation built from discovered timing.

Production changes belong only in `src/controller.ts` and `src/frozen-browser.ts`. Leave `src/worker-execution-scope.ts` unchanged.

Required behavioral proof:

- Literal results for baseline and browser intent, absence, request conflict, legacy execution, unconsumed acceptance, pending, recorded, and settled history.
- Diagnostic settled history with null evidence and incomplete cleanup.
- Original allowance after selection delay beside shorter historical execution timing.
- Original attribution after edits, interruption, retry, epoch advancement, and settled-history reopen.
- Missing-source rejection and malformed or foreign attribution rejection.
- No acquisition for `unrecorded`.
- Multiple records with different IDs and timing, proving every returned field comes from the selected record.
- Nested result mutation does not affect subsequent observations.
- Lazy, acquiring, held, and revoked-but-undrained scopes reject without another acquisition.
- Gated reads delay acceptance-only and later scope opening until historical closure.
- Close drains queued acquisition, guards, and closure before workspace and catalogue closure.
- Acquisition and closure failures drain without unhandled rejection and release ownership.
- Journal names, bytes, inode, mode, and mtime remain unchanged. Do not assert atime.
- Parked source and case state, checks, artifacts, budgets, attempts, contribution, and simulated status remain unchanged.
- Query-time inventory, recovery opening, save, finalize, client calls, validation, and check callbacks are forbidden.
- `BEGIN` precedes database-reading validation and both metadata and run reads. The transaction remains open through the final guard.
- Deliberate writes still fail. Sidecar rejection and exact-selector reader behavior remain intact.

Reuse the association fixture, cleanup record builders, and lifetime gates. Seed pending rows after controller startup. Do not execute consumption merely to create historical records.

Converter spies, where supported, supplement direct import and call-graph inspection. No converter invocation or `FrozenBrowserConsumedExpectation` construction is allowed.

## Limits and next step

Controller startup remains recovery-capable through `openWorkerJournalBinding` and `workerInventory` at `src/controller.ts:375-393`. The new query must not write. It does not make startup read-only or preserve pre-startup pending bytes unchanged.

Historical IDs and timing do not establish authorship, execution success, live cleanup, or future admission authority. Independent execution pins remain unretained.

The next step remains only the offline historical query and its tests. No converter, native, main, HTTP, schema, live-worker, or containment changes.

Laziness Protocol changed the choice to action-only inputs, existing tracking-set reuse, and deletion of the source-existence helper. Model the Domain kept unavailable independent pins separate from historical execution states. Both leaf skills were read fully. Poteto-mode was read fully before the designs. Investigation, how, unslop, no-comments, and technical-writing were also read. The task's no-spawn and no-source-edit constraints governed this review.