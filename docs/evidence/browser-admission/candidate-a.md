# Pure frozen-browser report admission

## Overview

Recommend an unwired, synchronous report-to-evidence conversion function as the next bounded prerequisite after offline workspace ownership.

Its consumer is a future trusted validation adapter. It returns detached observation data, not `CheckExecution`, controller permission, or a persisted check receipt.

This boundary can safely precede durable worker cleanup correlation because it performs no execution or persistence. Wiring it into controller execution cannot safely precede that correlation. Docker dispatch must remain disabled.

This investigation inspected clean checkout `9c862a0f04056b2a88c01fe12525e80e47ef7ef8`. No repository edits, tests, Docker operations, credential access, or nested agents occurred.

throughput checkpoint: n/a, read-only investigation

The current checkpoint explicitly leaves real-report admission and durable cleanup correlation open. Offline workspace ownership does not accept M2. See `docs/work-log.md`, section “Controller-owned workspace continuation on October 20”, and `docs/controller-workspace.md`, section “Limits”.

## Key concepts

### Frozen source and scripted candidate are different identities

`OfflineActionWorkspace.selection` identifies the action’s frozen case, Git revision, and manifest digest. The controller records it before callback entry. Editing A into B does not change the current action’s selection A. A later action can select B.

`CheckResult.candidate` remains the scripted adapter’s candidate identifier. It is not currently bound to that frozen revision.

The conversion must preserve the report’s real frozen tuple in a separate document. It must not overwrite scripted candidate values or relabel browser observations as simulated checks.

Sources include `src/controller.ts:454`, `src/domain.ts:111`, `docs/controller-workspace.md`, and `test/controller-workspace.test.ts:193`.

### Outcome and cleanup are independent facts

`FrozenBrowserReport` contains:

- `runId`.
- The complete `FrozenBrowserRequest`.
- A behavioral or non-behavioral `outcome`.
- Independent `cleanup`.
- Nullable evidence containing provenance, observations, and a PNG.

See `src/frozen-browser.ts:21-81`.

The fixed scenario has these meanings.

| Role | Complete A without page or console errors | Complete B without page or console errors |
| --- | --- | --- |
| Baseline | `baseline-reproduced` | `baseline-not-reproduced` |
| Candidate | `candidate-failed` | `candidate-passed` |

Other literals, startup failure, action failure, or page or console errors produce `unrelated-failure`. Bounded ordinary console messages are allowed.

This scenario does not run project unit tests, a project build, or a general regression suite. See `src/frozen-browser.ts:1025` and `docs/frozen-browser.md`.

For eventual check projection, baseline `passed: true` means reproduction succeeded. Candidate `passed: true` means the scenario observed B. Neither establishes that a deployed Sentry error stopped.

Cleanup is `not-needed`, `owned-removed`, or `incomplete`. Every variant retains cache. Successful behavior with incomplete cleanup remains an observation, but it is not eligible for a completed execution receipt. See `src/frozen-browser.ts:2040` and `test/frozen-browser.test.ts:1283`.

### Validation does not authenticate a report

The proposed boundary validates report structure, correlation, artifact integrity, and conversion semantics.

Matching hashes establish consistency with supplied expectations. They do not establish who produced the report or whether its stated Docker operations occurred. A fabricated, internally consistent report can pass those checks.

The intended producer remains the trusted in-process `FrozenBrowserValidator`. It owns protocol, containment, journal, and resource verification.

The report omits private intent facts such as owner and nonce and omits the resource ledger. It cannot replace the validator journal. `validateRecorded` uses those private facts and loaded trusted assets. Do not expose it as an arbitrary-report attestation API or duplicate its security verifier.

See `src/frozen-browser.ts:395-666`.

## How it works

### Current flow

1. Native `run_check` admits a tool action and supplies its bounded cancellation signal. See `src/native.ts:191-214` and `src/native.ts:250-269`.
2. The controller checks persisted action identity, epoch, state, and allowance. Offline configuration adds a durable frozen source selection before callback entry. See `src/controller.ts:998-1095`.
3. The controller races the callback against cancellation, parses its unknown return, revokes the source handle, and checks allowance again. Only completed simulated receipts continue. See `src/controller.ts:1098-1145` and `src/controller.ts:1680`.
4. Native validates the receipt, writes artifact blobs, writes manifests, records the check, and invokes checkpoint handling. These writes are not one atomic transaction. See `src/native.ts:436-523`.
5. Checkpoint handling can establish candidate identity, enter implementation, and affect repair accounting. Assessments require revision-bound evidence and matching configuration. Incorrect conversion therefore changes remediation behavior. See `src/controller.ts:1185-1290`.

The validator has a separate lifecycle. It journals intent and resources, verifies observations, commits evidence before cleanup, and returns a finalized report. Settled repeats return detached saved reports without rerunning or repairing cleanup.

Its configuration digest is computed privately during `open` from trusted assets, limits, image, entrypoint, and engine identity. See `src/frozen-browser.ts:1143`, `:1394`, and `:2040`.

### Proposed data shape

Name the return type `FrozenBrowserAdmission`.

Use a distinct discriminated union so it cannot masquerade as the existing check callback result. Retain the detached report for diagnosis. Only a behavioral decision carries admitted output bytes.

The first caller is a pure fixture test, not `Controller.open`.

```ts
const admission = admitFrozenBrowserReport(
	{
		kind: 'baseline',
		request: expectedBaselineRequest,
		configurationDigest: expectedConfigurationDigest,
	},
	reportFromTrustedValidator,
);
```

The proposed signature is below. These are proposed types, not existing exports.

```ts
type BaselineRequest = FrozenBrowserRequest & {
	readonly role: 'baseline';
};

type CandidateRequest = FrozenBrowserRequest & {
	readonly role: 'candidate';
};

type FrozenBrowserExpectation = Readonly<{
	configurationDigest: Sha256;
}> & (
	| Readonly<{
		kind: 'baseline';
		request: BaselineRequest;
	}>
	| Readonly<{
		kind: 'browser';
		request: CandidateRequest;
	}>
);

type BrowserBehavior =
	| 'baseline-reproduced'
	| 'baseline-not-reproduced'
	| 'candidate-passed'
	| 'candidate-failed';

type BehavioralReport = FrozenBrowserReport & Readonly<{
	outcome: Readonly<{ kind: BrowserBehavior }>;
	evidence: FrozenBrowserEvidence;
}>;

type FrozenBrowserAdmission =
	| Readonly<{
		type: 'behavioral';
		report: BehavioralReport;
		passed: boolean;
		outputs: readonly [ArtifactOutput];
	}>
	| Readonly<{
		type: 'blocked';
		reason:
			| 'cleanup-incomplete'
			| 'infrastructure'
			| 'unrelated-failure'
			| 'cancelled'
			| 'uncertain';
		report: FrozenBrowserReport;
	}>;

function admitFrozenBrowserReport(
	expected: FrozenBrowserExpectation,
	report: unknown,
): FrozenBrowserAdmission;
```

Use existing branded `Sha256` and `FrozenRevision` types. Malformed or mismatched input throws `ControlError('invalid-frozen-browser-admission')`. Invalid data is not a trustworthy infrastructure report.

Only baseline and candidate-browser projection are supported. Reject checkpoint, unit, regression, and build expectations. The request does not contain a check kind, so this restriction is explicit adapter policy.

The behavioral result contains exactly one copied PNG output labeled `Frozen browser screenshot`. Keep the complete detached report separately. Do not serialize the whole report into a text artifact. Its 8 MiB evidence ceiling exceeds the 256 KiB text-artifact ceiling. See `src/artifacts.ts:9-19`.

There is no scripted `candidate`, `simulated` flag, generated ID, clock, signal, workspace handle, validator instance, or persistence callback in this API.

### Exact conversion rules

Validate before choosing a disposition. Malformed data must reject even when cleanup is incomplete.

1. Validate the expected request through the existing request parser. Validate its independently supplied configuration digest and kind-role combination.
2. Require bounded data records and exact own keys on fixed shapes. Reject extra, hidden, or symbol keys and malformed variants. Do not use comma-joined key comparisons. Executable objects are not a report format.
3. Parse the returned request and require complete equality with expectations. Include case, action, epoch, scenario, role, frozen revision, manifest digest, and original allowance.
4. Validate and retain the run UUID. This preserves correlation data but does not establish durable association or deduplication.
5. Reuse existing outcome, cleanup, evidence, and PNG parsing. Copy nested objects because the private object parser can retain references.
6. For supplied evidence, require the expected request digest, configuration digest, and frozen tuple. Validate timestamps and require `deadline === admittedAt + allowanceMs` and `finishedAt >= admittedAt`. Require exit zero and `oomKilled === false`.
7. Validate canonical transfer paths, unique entries, file bounds, and total bounds. Require the observations’ manifest to match the transfer manifest.
8. Validate classification inputs, including stage, nullable bounded literal, and bounded exact event records. Do not duplicate the full process-census or applied-container verifier.
9. Decode canonical base64. Require exact MIME, byte count, and SHA-256. Use `validateOutput` for PNG structure, CRC, dimensions, and decompression validation.
10. Require evidence for behavioral outcomes and `unrelated-failure`, matching existing committed-evidence semantics. Evidence paired with `not-needed` cleanup is inconsistent because it names acquired resources.
11. Require role-correct classification for behavioral outcomes and `unrelated-failure`. Behavioral completion must be within the recorded deadline.
12. Preserve cancellation or uncertainty even when retained observations contain B. Retained observations cannot promote those outcomes.
13. Incomplete cleanup returns blocked `cleanup-incomplete` before behavioral eligibility. Preserve the original outcome inside the retained report.
14. Otherwise, infrastructure failure, unrelated failure, cancellation, and uncertainty return their blocked reasons without outputs.
15. Behavioral outcomes require `owned-removed` cleanup. Set `passed` to true only for `baseline-reproduced` and `candidate-passed`.

Repeated conversion returns equal values with no shared mutable objects or byte arrays.

No step executes Docker, opens storage, reads current workspace bytes, checks current authority, checks wall-clock freshness, performs cleanup, or advances a remediation session. Time checks compare recorded values only.

The expected request and configuration must come from independent trusted context. Copying them from the report defeats correlation. Pure tests can supply independent fixture expectations. This increment needs no production configuration getter or boot wiring merely to create a caller.

### Success criteria and negative cases

The future implementation is accepted only with these checks.

| Area | Required cases |
| --- | --- |
| Behavioral meaning | Baseline A returns true, baseline B returns false, candidate B returns true, and candidate A returns false. Assert complete expected results. |
| Scenario limits | C, startup failure, action failure, console error, and page error remain unrelated. Ordinary bounded console messages remain allowed. Unsupported check kinds reject. |
| Correlation | Independently mutate case, action, epoch, scenario, role, allowance, revision, manifest digest, request digest, and configuration digest. Every mismatch rejects. |
| Cleanup | Every outcome with incomplete cleanup is blocked without outputs. Preserve committed success inside the report. Reject evidence with `not-needed`. Allow no-evidence infrastructure with `not-needed`. |
| Non-behavior | Infrastructure, unrelated failure, cancellation, and uncertainty never become failed behavioral checks. Cancellation retaining B never passes. Missing required evidence rejects. |
| Integrity | Reject noncanonical base64, incorrect MIME, size or hash, malformed PNG, excessive dimensions, oversized evidence, duplicate paths, and manifest disagreement. |
| Variants and time | Reject invalid identities and numbers, extra or hidden keys, symbol keys, comma-key collisions, bad cache values, role-outcome contradictions, invalid deadline arithmetic, and late behavioral completion. |
| Detachment | Input mutation and mutation of one returned result cannot alter another result. PNG bytes cannot alias caller-owned memory. |
| Purity | Direct tests require no workspace, database, subprocess fixture, clock, signal, or Docker. Import and invocation perform no storage or execution effects. |
| Integration remains disabled | Existing controller and native rejection of non-simulated receipts remains unchanged. No production route imports or invokes the helper. |

Add direct tests in `test/frozen-browser-admission.test.ts`. Use finite synthetic report data and a valid literal PNG fixture. Those fixtures prove conversion, not execution.

Existing complementary tests were inspected:

- `test/frozen-browser.test.ts:871` covers role classification.
- `test/frozen-browser.test.ts:1283` covers committed behavior with failed cleanup.
- `test/frozen-browser.test.ts:1303` covers unresolved create cleanup.
- `test/check-dispatch.test.ts:425-482` rejects malformed and non-simulated receipts.
- `test/check-dispatch.test.ts:656` protects newer Retry epochs from late callbacks.
- `test/controller-workspace.test.ts:193` exercises A/B selection and fresh authority.
- `test/evidence.test.ts` covers revision-bound evidence and repair behavior.
- `test/artifact-resources.test.ts` covers stored provenance and passive retrieval.

These tests were read, not rerun.

### Why cleanup correlation can wait only for the pure boundary

The controller cancellation race can finish before underlying callback work drains. Source-handle revocation does not terminate a worker. Native also has its own abort boundary. Controller close drains owned workspace work, not arbitrary callback effects.

See `src/controller.ts:1108`, `src/native.ts:191-214`, and `docs/check-execution.md`, section “Limits”.

The validator durably owns its runs, but no controller-owned association settles a worker run together with action authority and native evidence. Matching action fields in a report does not close that crash boundary.

Before wiring, a separate design must address:

- Durable action-to-run association.
- Cleanup-incomplete and unresolved-daemon recovery.
- Timeout drainage and late results.
- Fresh Retry authority.
- Ordering with native evidence persistence.
- Real receipt identity and configuration compatibility across required check kinds.

This design does not choose that lifecycle implementation.

## Where things live

The proposed implementation scope is three files.

| File | Change |
| --- | --- |
| `src/frozen-browser.ts` | Add expectation and admission types and the synchronous conversion function beside existing private parsing and classification helpers. Add local conversion guards without changing existing execution or parser behavior. |
| `test/frozen-browser-admission.test.ts` | Add direct pure-boundary tests using synthetic reports and valid PNG bytes. |
| `docs/frozen-browser.md` | Document the unwired contract, validation limits, and prohibition on treating its result as controller evidence. |

Keeping the function in the existing module avoids exporting private lifecycle parsers or copying the containment verifier. A report-codec extraction would widen this prerequisite without making execution safer.

Keep domain, controller, native, artifacts, workspace storage, HTTP, production main, worker assets, Rust, dependencies, schemas, and historical evidence unchanged.

For an authorized implementation, run the new tests, existing controller/evidence regressions, and non-Docker verification. The default Node test glob excludes integration tests. No new Docker run is needed to establish pure conversion.

## Gotchas

- Relaxing only `parseCheckExecution` is unsafe. Controller case loading, native metadata, native writes, and artifact validation independently require simulated data. Native also derives the persisted simulated flag from the case. Partial relaxation can fail later or mislabel observations. See `src/controller.ts:642`, `:1717`, `src/native.ts:390`, `:453-475`, and `src/artifacts.ts:72`.
- Do not return this document through a completed callback envelope. Its distinct shape and the current exact-key parser should reject accidental wiring.
- Do not convert infrastructure or unrelated failure to `passed: false`. Existing checkpoint handling can enter implementation after a failed non-baseline check. See `src/controller.ts:1206`.
- `owned-removed` does not mean cache or physical disk was reclaimed. It also cannot erase unresolved late daemon effects. See `docs/frozen-browser.md`.
- Conversion consistency checks do not repeat full containment verification. The trusted producer and its journal remain necessary. See `src/frozen-browser.ts:395` and `:907`.
- `src/main.ts` still configures faux inference without workspace or checks. M2 and later live gates remain open.

Boundary Discipline shaped the pure conversion without execution or persistence. Model the Domain shaped the behavioral-versus-blocked union. Type System Discipline shaped the role-specific expectations and result that cannot masquerade as `CheckExecution`. Those principle skills were read in full.

## Delivery and validation

Completed the bounded design. No implementation files changed.

The write tool rejected the authoritative output path because it is outside the checkout. This complete document is returned for runtime persistence to:

`/Users/felix.langbein/.pi/agent/sessions/--Users-felix.langbein-projects-eitri--/subagent-artifacts/outputs/7c189bc8-0a16-4b0f-95a8-dd14f51d515f/design/pure.md`

Recommended next step is independent review, followed by authorization of only the three-file pure-boundary increment.