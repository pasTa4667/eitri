The artifact tool refused the configured path outside the working directory. These are the complete findings for runtime persistence at:

`/Users/felix.langbein/.pi/agent/sessions/--Users-felix.langbein-projects-eitri--/subagent-artifacts/outputs/7c189bc8-0a16-4b0f-95a8-dd14f51d515f/design/controller.md`

# Controller-owned real-report admission design

## Overview

At `9c862a0f04056b2a88c01fe12525e80e47ef7ef8`, the controller owns offline workspace selection, but every accepted check and artifact remains simulated. The accepted browser validator is separately callable and remains unwired.

**Recommendation.** Implement an unwired, correlation-aware report conversion boundary next. Return a distinct browser observation, never the current `CheckExecution` or `CheckResult`. This can safely precede durable cleanup correlation because it performs no effects and grants no receipt authority.

Prefer controller-owned admission for eventual integration. That design must join persisted action sources to owned validator runs and introduce typed real evidence. Durable cleanup correlation, candidate semantics, native persistence, and truthful presentation remain prerequisite gates. Do not enable Docker dispatch in this unit.

This is a read-only design. No repository files changed. No tests, Docker, credentials, external services, commits, or nested agents were run.

throughput checkpoint: n/a, read-only investigation

## Key concepts

### Existing data shapes

- `AdmittedCheckRequest` carries the persisted case/action identity, epoch, check kind, remaining allowance, and cancellation signal. The request is correlation data, not independent authority. See `src/domain.ts:121` and `src/controller.ts:999`.
- `OfflineActionWorkspace.selection` is a `FrozenRevision` containing case ID, Git revision, and manifest digest. The controller persists selection before callback entry. Reading the selection still returns A after an edit creates B. See `src/controller.ts:58` and `:455`.
- `ActionSource` retains the complete admitted action and check kind. Its states are `selecting`, `selected`, `settled`, and `interrupted`. It is not a worker-run or cleanup ledger. See `src/controller.ts:76`, `:393`, and `:570`.
- `CheckExecution` separates completed simulated checks from infrastructure, unrelated failure, cancellation, uncertainty, and incomplete cleanup. Only `completed` carries a `CheckResult`. See `src/domain.ts:129`.
- `FrozenBrowserRequest` binds a frozen tuple, matching case/action/epoch, `synthetic-click-v1`, baseline or candidate role, and allowance between 1 and 60000 milliseconds. It has no controller check kind. See `src/frozen-browser.ts:21` and `:189`.
- `FrozenBrowserReport` contains `runId`, echoed request, outcome, independent cleanup status, and nullable evidence. Evidence includes provenance, observations, and one base64 PNG. Every cleanup variant reports retained cache. See `src/frozen-browser.ts:28-80`.

A valid behavioral observation can coexist with incomplete cleanup. The existing regression explicitly preserves that distinction in `test/frozen-browser.test.ts:1283`.

### Proposed data shape

The next boundary returns `FrozenBrowserConversion`. Its positive variant contains an unadmitted `FrozenBrowserObservation`.

For eventual controller admission, use a discriminated evidence origin instead of weakening a boolean guard:

```ts
type EvidenceOrigin =
	| Readonly<{
		kind: 'scripted';
		simulated: true;
		simulatedCandidate: string;
	}>
	| Readonly<{
		kind: 'frozen-browser';
		simulated: false;
		frozen: FrozenRevision;
		runId: string;
		requestDigest: string;
		configurationDigest: string;
		role: 'baseline' | 'candidate';
		scenarioId: 'synthetic-click-v1';
	}>;
```

This is an internal target sketch, not a wire-format change for the next unit.

`simulated: false` means the browser execution was real. It does not mean live inference, real Sentry reproduction, authenticated report authorship, or a verified fix. The browser scenario remains synthetic.

Checks and artifacts must derive matching origin data from one admitted evidence value. They must not inherit origin from `Case.simulated`.

## How it works

### Current flow

```text
Scripted run_check tool
  -> persisted tool Action
  -> controller authority and allowance check
  -> optional persisted action_sources selection
  -> configured callback
  -> strict simulated CheckExecution parser
  -> native blob, manifest, and check writes
  -> controller checkpoint and assessment gates

Separate, unwired FrozenBrowserValidator
  -> verified frozen bytes and owned worker run
  -> committed observation
  -> cleanup attempt
  -> FrozenBrowserReport
```

1. `NativeCase` admits a tool action with a 60000-millisecond limit. Its wrapper races work against timeout, journals the result, and finishes the action. Timeout does not drain the underlying promise. See `src/native.ts:200` and `:626`.
2. `Controller.dispatchCheck` compares the complete action against its persisted row. It checks epoch, case state, native/workspace readiness, and remaining allowance. Offline mode persists source selection before entering the callback. Source preparation does not renew the allowance. See `src/controller.ts:999-1137`.
3. `parseCheckExecution` treats callback returns as unknown data. It checks exact own-key membership and count, validates and copies output bytes, and requires `simulated === true`. The controller rechecks authority after callback completion. See `src/controller.ts:1680-1752`.
4. Non-behavior outcomes stop conservatively without adding evidence or changing repair history. A pending pause retains its existing settlement precedence. See `test/check-dispatch.test.ts:314`.
5. `NativeCase.recordCheck` guards asynchronous writes separately. It writes blobs, artifact manifests, the check receipt, and a note before checkpointing. Those writes are not one atomic transaction across stores. The writer currently derives persisted `simulated` from the case. Native metadata loading and artifact validation also require simulated evidence. See `src/native.ts:341-525` and `src/artifacts.ts:44-87`.
6. Baseline pass means the target defect reproduced. Baseline failure parks the case. Later failed checks can set `failedCandidate` and return to implementation. Assessments require same-candidate evidence and common configuration for the required suite. See `src/controller.ts:1186-1290`.
7. Settlement deletes the live action while retaining source history. Recovery interrupts unfinished selections and verifies historical frozen bytes. It does not open a validator or reconcile its journal. See `src/controller.ts:570`, `:1145`, and `:1377`.

The separate validator already owns durable intents, reservations, resource identities, result commitment, and cleanup. Exact duplicate requests share or reuse execution. Interrupted runs recover conservatively without replay. None of those records is durably joined to controller evidence settlement today. See `src/frozen-browser.ts:585`, `:1280`, `:1394`, and `:2040`.

### Design A. Unwired pure report conversion

The caller supplies an independently chosen expectation before inspecting the report. Expected identity must not be copied from the report being checked.

Caller-first sketch, with proposed symbols:

```ts
const conversion = convertFrozenBrowserReport(
	{
		request: selectedRequest,
		checkKind: admitted.kind,
		contract: trustedReportContract,
	},
	syntheticOrRecordedReport,
);
// Inspect conversion only. There is no recordCheck call.

type FrozenBrowserExpectation = Readonly<{
	request: FrozenBrowserRequest;
	checkKind: 'baseline' | 'browser';
	contract: FrozenBrowserReportContract;
}>;

type FrozenBrowserObservation = Readonly<{
	request: FrozenBrowserRequest;
	runId: string;
	configurationDigest: string;
	outcome:
		| 'baseline-reproduced'
		| 'baseline-not-reproduced'
		| 'candidate-passed'
		| 'candidate-failed';
	predicatePassed: boolean;
	evidence: FrozenBrowserEvidence;
	screenshot: ArtifactOutput;
}>;

type FrozenBrowserConversion =
	| Readonly<{
		type: 'behavioral';
		observation: FrozenBrowserObservation;
	}>
	| Readonly<{
		type: 'stopped';
		reason:
			| 'infrastructure'
			| 'unrelated-failure'
			| 'cancelled'
			| 'uncertain'
			| 'cleanup-incomplete';
	}>
	| Readonly<{ type: 'invalid'; code: string }>;

declare function convertFrozenBrowserReport(
	expected: FrozenBrowserExpectation,
	value: unknown,
): FrozenBrowserConversion;
```

`FrozenBrowserReportContract` is a trusted immutable descriptor of the existing validator configuration and report-level checks. It is not callback-supplied execution configuration.

Share the current configuration calculation and pure validation rules. Do not copy a digest into a second source of truth. The current calculation loads trusted assets inside `open`, while replay validation uses private journal intent fields. Preserve that distinction. See `src/frozen-browser.ts:395-677` and `:1110-1154`.

The converter performs these operations:

- Parse exact report structure.
- Match the independently expected request and configuration.
- Validate internal integrity and compatible outcome semantics.
- Return detached evidence and validated PNG bytes.
- Return no controller check or admission capability.

It performs no I/O, store opening, subprocess execution, cleanup, or controller mutation. Module import must not read trusted assets. Existence and ownership of the selected frozen revision remain responsibilities of the workspace/controller owner.

Use only two role/kind pairs in this bounded design:

- Baseline role maps to controller baseline.
- Candidate role maps to controller browser.

Reject checkpoint, unit, regression, and build kinds. A static browser observation cannot manufacture those checks.

The behavioral mapping is exact:

| Report role and outcome | Predicate | Future controller meaning |
| --- | --- | --- |
| baseline, baseline-reproduced | true | Target assertion reproduced. |
| baseline, baseline-not-reproduced | false | Reliable non-reproduction. |
| candidate, candidate-passed | true | Candidate satisfies this scenario. |
| candidate, candidate-failed | false | Candidate fails this scenario. |

Share the protected observation classification. A complete clean baseline A reproduces. Baseline B does not. Candidate B passes, and candidate A fails. Other literals, startup/action failure, page errors, and console errors are unrelated failure. Ordinary console messages remain data, including protocol-looking text. See `src/frozen-browser.ts:907-1044` and `test/frozen-browser.test.ts:871`.

Validate the whole report before disposition. For a valid report, incomplete cleanup prevents behavioral eligibility regardless of observed behavior. It returns `cleanup-incomplete`. Other non-behavior outcomes return their corresponding stop. None carries an admit-ready check.

Do not erase the validator's durable observation when conversion declines to return behavioral evidence.

#### Safety before durable cleanup correlation

This boundary is safe while unwired because its output is not assignable to the existing completed-check envelope and has no persistence path.

Its cleanup status remains a validated claim. A positive conversion does not prove owned removal or authorize evidence admission. Synthetic fixtures and authentic captured reports can both pass pure validation.

Do not describe public report validation as equivalent to `parseRun`. Journal replay also checks independently stored owner, nonce, acquired IDs, deadline, and request/configuration identity. A standalone report does not independently establish those facts. Keep journal-bound verification in the validator.

### Design B. Controller-owned admission with typed evidence

This design changes ownership rather than wrapping reports into the existing callback. A trusted driver supplies raw reports. The controller constructs requests from persisted source selections and decides admission.

A callback never supplies a real `CheckResult`.

Caller-first target sketch:

```ts
// Inside controller-owned dispatch.
const plan = this.planBrowserValidation(action, kind);
const report = await trustedDriver.validate(plan.request, signal);
const receipt = await this.admitBrowserReport(
	plan.actionId,
	report,
	signal,
);

type TrustedBrowserDriver = Readonly<{
	validate(
		request: FrozenBrowserRequest,
		signal: AbortSignal,
	): Promise<unknown>;
}>;
```

These are internal methods, not HTTP or model-tool APIs.

`planBrowserValidation` uses the stored `selected` `ActionSource`, including the full action and check kind. It does not use the latest worktree, an assessment's candidate string, a retained callback handle, or report-provided source identity.

The controller chooses scenario and role from trusted configuration and recomputes remaining allowance immediately before dispatch. An edit after selection still leaves this action bound to A.

Before effects, the controller needs a durable worker association keyed by action identity. It retains:

- Validator owner and configuration identity.
- Exact request and request digest.
- Selected frozen tuple.
- Eventual run ID.
- Cleanup disposition.
- Deterministic native receipt identity.

Proposed lifecycle states are `planned`, `reported`, `admitted`, and `blocked`.

The validator remains the resource-cleanup owner. The controller owns whether a worker association permits receipt commitment or another dispatch.

Persisting `planned` alone does not close the crash gap. The current validator generates `runId` internally and exposes no read-only lookup by action identity. Recovery therefore needs an explicit owned journal-query contract.

Do not call `validate` to discover an absent run. That call could start a new effect. Missing, conflicting, or unresolved associations must remain blocked until a reviewed reconciliation policy establishes what happened.

`admitBrowserReport` reloads all authority after asynchronous work. It requires:

- Same persisted case/action/epoch and complete action.
- Selected source and requested kind.
- Matching planned request and configuration.
- Valid remaining allowance and cancellation state.
- An owned settled worker report.
- Acceptable independently reconciled cleanup.

Identical duplicate admission returns the same receipt. Conflicting report content fails closed. Old Retry epochs cannot affect newer evidence.

Native then receives a distinct typed real evidence value. It records actual frozen revision, manifest, run identity, configuration, and origin. It must not replace real provenance with `Case.simulated === true`. Artifacts inherit the admitted check's origin.

#### Candidate and phase-gate constraint

Typed real evidence still cannot safely mix with current scripted checkpoints.

There is no existing relationship between simulated `CheckResult.candidate` and the workspace SHA. Nor is there a shared suite configuration that equates browser configuration with scripted unit/build configuration.

Keep real baseline/browser evidence separate from scripted phase-gate evidence until the controller explicitly owns:

- Real candidate selection and revision identity.
- Origin-aware assessment rules.
- Configuration compatibility.
- Semantics for every required check.

Changing a boolean to a union does not supply those guarantees.

### Comparison

| Concern | Pure conversion | Controller-owned admission |
| --- | --- | --- |
| Owner | Stateless report boundary. | Catalogue and native runtime. |
| Identity | Independent caller expectation. | Reloaded persisted action/source and worker association. |
| Output | Unadmitted observation or rejection. | Typed durable receipt. |
| Cleanup | Validates claimed status. | Requires owned reconciliation and drainage. |
| Crashes | No effects to replay. | Reconciles controller, validator, and native-store gaps. |
| Scripted candidates | Unchanged. | Requires distinct identity and gate policy. |
| Next bounded unit | Recommended. | Not ready for real receipts or execution. |

### Prerequisite gates

1. **Shared report contract.** Define the pure report parser/classifier and trusted configuration descriptor. Preserve journal-only checks and existing validator behavior.
2. **Candidate and evidence model.** Establish controller-owned real revisions and origin-aware gates. Define configuration compatibility for the complete required suite.
3. **Durable worker correlation.** Add owned read-only lookup, controller-to-validator binding, idempotent admission, and recovery without new execution. Unknown build/create states remain blocked.
4. **Cancellation and shutdown drainage.** Stop admission, abort and drain validator finalization, reconcile cleanup, then close the borrowed workspace and catalogue.
5. **Native persistence and recovery.** Introduce typed real receipts/artifacts and deterministic admission identity across separate blob, manifest, receipt, action-result, and catalogue writes.
6. **Presentation and authorization.** Migrate readers and truthful labels before exposing real evidence. Explicitly authorize execution separately. The current notice that no worker runs cannot describe an enabled real-browser mode.

These gates can be designed or tested with synthetic data before execution authorization. None is satisfied by this report. M2 and later human-presence gates remain open.

### Exact success criteria for the next implementation

The pure boundary is complete only when all these conditions hold:

1. Its only new callable behavior converts unknown report data plus independent expectation into `FrozenBrowserConversion`. No controller/native/HTTP/main entry point calls it.
2. Exact schemas, identity formats, numbers, role/kind compatibility, and copied data are validated. Reject extra fields and property-name collisions. At a JavaScript-object boundary, reject symbols, inherited required fields, non-enumerable substitutions, and accessors.
3. Request equality includes case, action, epoch, frozen case/revision/manifest, scenario, role, and original allowance. Request digest and evidence provenance agree with the expectation. Conversion never renews allowance.
4. Behavioral outcomes require complete valid evidence. Validate canonical base64, decoded PNG size/hash/MIME, and existing PNG byte checks. Preserve bounded provenance and observations without physical host paths.
5. Apply the existing 8 MiB evidence and 4 MiB PNG ceilings and bounded nested collections. Do not serialize a whole report into the 256 KiB text-artifact slot.
6. Share existing report-level semantic checks, including classification and containment claims. A claimed candidate pass beside literal A or unsafe reported settings is rejected. Do not weaken journal replay checks to expose a public parser.
7. Only the four compatible behavioral outcomes with complete evidence and `owned-removed` cleanup return observations. `not-needed` is valid for runs without owned effects, but contradicts this validator's behavioral browser execution. Incomplete cleanup prevents behavioral eligibility.
8. Infrastructure, unrelated failure, cancellation, and uncertainty never become behavioral failures or admit-ready evidence.
9. Returned objects and PNG bytes are detached. Input/output mutation cannot affect another conversion or saved data.
10. Existing public controller regressions still reject non-simulated callback receipts. Scripted candidates, repair behavior, phase gates, production mode, execution API, worker assets, and containment settings remain unchanged.
11. Tests prove import and conversion perform no store opening, asset reads, subprocess calls, or Docker invocation. Existing fast validator behavior survives shared-rule extraction unchanged.
12. Fresh source/security review passes before acceptance.

Required negative cases include:

- Wrong case, action, epoch, role, scenario, allowance, revision, manifest, request digest, or configuration.
- Internally consistent reports that differ from the independent expectation.
- Unsupported checkpoint/unit/regression/build kinds.
- Missing evidence, corrupt PNG CRC/decompression, noncanonical base64, wrong size/hash, oversized evidence, malformed nested observations, and extra/collision-shaped keys.
- Role/outcome mismatch, claimed pass with wrong literal, incomplete action, page/console errors, missing security witnesses, or contradicted applied settings.
- Behavioral success or failure with incomplete cleanup.
- Behavioral evidence with contradictory `not-needed` cleanup.
- Non-behavior outcomes that retain earlier evidence. They still return no admit-ready receipt.
- Perfectly self-consistent forged fixtures. Document that pure validation cannot distinguish them, and prove they cannot create controller checks or artifacts.
- Input/output mutation and duplicate conversion.

Before Design B is accepted, additionally require public Controller and crash tests for:

- Selected A after edited B.
- Two-case isolation.
- Missing, interrupted, or settled source authority.
- Late old-epoch reports after Retry.
- Pause and allowance expiry at write boundaries.
- Duplicate and conflicting reports.
- Owned-run lookup without new effects.
- SIGKILL across controller, validator, and native commitment gaps.

A fixture claiming clean cleanup does not prove real drainage.

## Where things live

| File | Ownership |
| --- | --- |
| `docs/work-log.md` | Current checkpoint and remaining report/cleanup prerequisites. |
| `docs/check-execution.md` | Scripted callback and conservative disposition. |
| `docs/controller-workspace.md` | Offline binding and action-source lifecycle. |
| `docs/frozen-browser.md` | Unwired validator contract and limitations. |
| `src/domain.ts:97-147` | Current artifact/check/request/outcome shapes. |
| `src/controller.ts:393-607` | Persisted source selection and recovery. |
| `src/controller.ts:999-1290` | Dispatch, settlement, checkpoint, and assessment. |
| `src/native.ts:200-275` | Tool lifetime and check dispatch. |
| `src/native.ts:341-525` | Evidence loading and persistence. |
| `src/artifacts.ts:10-87` | Limits, PNG validation, simulated manifests. |
| `src/frozen-browser.ts:278-677` | Evidence/report and journal replay checks. |
| `src/frozen-browser.ts:1025` | Protected classification. |
| `src/frozen-browser.ts:1394`, `:2040` | Deduplication and finalization. |
| `worker/frozen-browser/scenario.json` | Fixed synthetic A/B scenario. |
| `operator/src/client.rs:43-140` | Check/artifact decoding and linkage. |
| `operator/src/main.rs:475` | Simulated evidence labels. |
| `test/controller-workspace.test.ts:193`, `:735` | A/B provenance and foreign source rejection. |
| `test/check-dispatch.test.ts:314`, `:431`, `:656`, `:910` | Stops, malformed data, Retry, and pause behavior. |
| `test/frozen-browser.test.ts:669`, `:871`, `:1283`, `:1331` | Detached reports, classification, cleanup, required evidence. |
| `test/evidence.test.ts:133` | Scripted same-revision gates and artifact integrity. |
| `test/integration/frozen-browser.test.ts:24` | Explicitly gated actual-Docker acceptance. |

### Bounded file scope

For Design A, allow:

- New `src/frozen-browser-report.ts`.
- New `test/frozen-browser-report.test.ts`.
- Narrow extraction/import changes in `src/frozen-browser.ts` to share report-level rules and trusted configuration identity.
- Changes in `test/frozen-browser.test.ts` only to prove extraction equivalence.
- Normal documentation, evidence, work-log, and decision records.

Exclude domain/controller/native/artifact persistence, HTTP, production main, workspace ownership, Rust, worker assets, dependencies, and policy files.

Reuse `validateOutput` without editing it. If pure-rule sharing requires a broader validator rewrite, split that prerequisite for review.

Design B later requires coupled changes to domain/controller/native/artifact handling, a validator read-only recovery/query contract, and controller/evidence/crash tests. Protocol and presentation migration also requires Rust changes. That is separate reviewed work.

## Gotchas

- **Validation is not authentication.** Digests establish equality and internal integrity, not authorship. UUIDs, matching source hashes, owner labels, and sandbox text can be fabricated. Eventual trust comes from the configured in-process driver and owned journal under the validator's documented single-owner assumption.
- **Reported settings are not observed settings.** A parser cannot observe containers, prove cleanup, verify absent stdout preimages, or attest an entire process lifetime.
- **No evidence means no report configuration digest.** The current report places configuration identity inside evidence. Non-behavior reports without evidence cannot independently establish configuration. They must never become receipts.
- **Source identity differs from scripted candidate identity.** Existing callbacks return arbitrary valid-looking simulated candidate hashes while selecting real Git revisions. Do not overwrite those values with the selected SHA.
- **Baseline pass means reproduction.** Mapping baseline-reproduced to false would invert the controller contract.
- **Cleanup failure does not erase behavior.** A committed observation can survive incomplete cleanup. Exact repeats do not rerun or repair cleanup. Retained cache is not reclaimed disk space.
- **Timeout is not drainage.** Callback races, revoked handles, and current controller close do not establish that arbitrary effects stopped.
- **Pending-pause behavior is specific.** Existing completed failed baselines retain ordinary Needs attention behavior during pause. Preserve the regression in `test/check-dispatch.test.ts:910`.
- **Historical tests were not rerun here.** `docs/evidence/controller-workspace/verification.md` records 420 Node and 30 Rust tests. `docs/evidence/validator-integration/verification.md` records the accepted 20-test Docker suite. This investigation read those records but did not independently rerun their runtime evidence.

### Principles that changed the recommendation

- Model the Domain produced separate observations, typed origins, and independent cleanup disposition.
- Boundary Discipline kept parsing pure and live authority with controller/validator owners.
- Type System Discipline kept real evidence outside simulated `CheckResult`.
- Laziness Protocol limited the next unit to an unwired boundary.
- Make Operations Idempotent required owned lookup and stable receipt identity before crash-safe admission.

### Validation performed

Read the requested context, skills, source contracts, relevant tests, and verification records.

`git rev-parse HEAD` returned the requested revision. Final `git diff --exit-code`, `git diff --cached --exit-code`, and `git status --porcelain=v1` confirmed an unchanged, unstaged repository.

A focused search found no browser-validator references in controller/native/main/HTTP production files.

Implemented no code. Completed the bounded design above.
Changed files: none. Artifact write was blocked.
Validation: static source tracing and Git cleanliness checks.
Open risks: runtime artifact persistence and independent review remain pending.
Recommended next step: review Design A's pure contract before implementation.