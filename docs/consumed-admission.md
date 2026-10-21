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

## Scope

Conversion performs no journal acquisition, writes, execution, cleanup or clock reads. It establishes consistency, not authorship, containment, executed cleanup, current controller authority or daemon quiescence. It does not create a native check receipt.

Controller retrieval correlation, native real-check admission, actual fixture validation and M2 acceptance remain separate work. This converter does not enable live integrations.
