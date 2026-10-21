# Consumed-browser report conversion

`admitFrozenBrowserConsumedReport(expected, value)` converts settled historical consumed-run claims into the existing `FrozenBrowserAdmission` result. It is a pure library function in `src/frozen-browser.ts`. Production entry points do not call it.

## Independent expectation

`FrozenBrowserConsumedExpectation` extends the ordinary baseline or browser expectation with these fields.

- `consumedRun` contains exactly `acceptanceId`, `runId`, and `requestDigest`.
- `admittedAt` pins the actual execution start.
- `deadline` pins the actual execution deadline.

The existing `request` retains its original allowance. The expectation's selector, request, configuration and actual timing must come from independently retained execution facts, not from the history being converted. Types and consistency checks cannot establish that independence.

Both timing endpoints must be nonnegative safe integers. The actual interval must be positive and no greater than the original request allowance. Full-length execution is permitted. Safe actual endpoints do not require a safe hypothetical full-allowance endpoint.

## Historical input

The unknown input must have the exact settled `FrozenBrowserConsumedReport` structure returned by [historical retrieval](worker-reports.md). Pending and recorded history reject. The converter matches every selector field, both actual timestamps, the report's run identity, the complete original request, and its digest. Evidence must match the pinned configuration and actual timing.

Both arguments pass through bounded own-data snapshots before inspection. Malformed structures, accessors, proxies, extra keys, unsafe numbers and inconsistent claims reject with `invalid-frozen-browser-admission`. Results and screenshot bytes are detached.

## Results

Behavioral reports return their literal-derived outcome, passed flag and decoded PNG bytes. Incomplete cleanup blocks conversion to a behavioral result. Infrastructure failure, unrelated failure, cancellation and uncertainty remain blocked. Malformed evidence cannot become valid by selecting a blocked outcome.

Observed outcomes require evidence and must finish by the actual deadline. Finishing exactly at the deadline is permitted. Infrastructure failure, cancellation and uncertainty retain ordinary admission's separate diagnostic timing and null-evidence rules.

Ordinary `admitFrozenBrowserReport` still requires full-allowance timing. Neither function rewrites requests, digests or provenance. They share the private evidence validation and classification implementation.

## Controller query

`Controller.inspectWorkerConsumedAdmission(caseId, actionId)` returns `WorkerConsumedAdmissionObservation` from one immediate `inspectWorkerConsumedHistory` call. The historical query captures original intent and independently retained pins before queueing acquisition. The controller builds the expectation only from those pins and passes `history.value` to the converter after historical closure.

Nonconsumed states remain unchanged. Consumed pending or recorded history returns `conversion.state: 'not-settled'`, even when pins are unavailable. Settled history without retained pins returns `independent-pins-unavailable`. Settled history with retained pins returns `converted` with either a behavioral or blocked admission. Invalid conversion claims reject rather than becoming absence or behavioral failure.

TypeScript callers narrow the pins' own discriminant before reading an unavailable reason.

```ts
const observed = await controller.inspectWorkerConsumedAdmission(caseId, actionId);
if (observed.state === 'consumed') {
	const pins = observed.independentExecutionPins;
	if (pins.state === 'unavailable') console.log(pins.reason);
}
```

The outer inspection promise is tracked synchronously. Controller close drains accepted inspections through conversion and rejects new calls. The [controller history reference](controller-worker-history.md#controller-consumed-report-conversion) describes attribution, busy scopes, and error propagation.

## Scope

Conversion performs no journal acquisition, writes, execution, cleanup or clock reads. It establishes consistency, not authorship, containment, executed cleanup, current controller authority or daemon quiescence. It does not create a native check receipt.

The [controller facts query](controller-worker-history.md#controller-retained-live-execution-facts) exposes detached original intent, pinned journal binding, consumed-run identity, and actual timing retained after each new worker admission commit and before execution. The historical query projects the same controller-owned pins separately from journal-derived history. Missing facts remain unavailable and are never backfilled from history. Worker and controller commits remain separate, so a crash before the controller commit can leave facts absent. Existing or recovered consumption never backfills them.

The raw history and facts queries do not invoke this converter. The consumed-admission query invokes it without admitting a native check. The separate [native consumed-check boundary](native-browser-check.md) adds fresh authority checks and native receipt persistence. Production report handoff, actual fixture validation, and M2 acceptance remain separate work. This converter does not enable live integrations.
