# Frozen-browser report conversion judgment

## Review

- Correct: Both designs recommend an unwired pure conversion before controller integration. This matches the remaining prerequisites in `docs/work-log.md:206-208`.
- Correct: A's behavioral-versus-blocked union preserves independent outcome and cleanup facts. The validator commits observations before cleanup, and its regression preserves success after cleanup failure. See `src/frozen-browser.ts:1811-1818`, `:2040-2082`, and `test/frozen-browser.test.ts:1283-1301`.
- Finding: P1. A's parser reuse needs an own-data guard **before** parsing either argument. The current parsers read properties directly, and `evidence()` calls `JSON.stringify` before validating nested objects. Passing an unknown object directly can invoke accessors or serialization hooks. See A's “Exact conversion rules”, steps 1-5, and `src/frozen-browser.ts:146-154`, `:189-191`, `:308-312`. Graft B's strict object validation as the first operation.
- Finding: P1. A's deadline rule omits `unrelated-failure`. Existing replay validation includes that outcome in its evidence-backed classification and deadline checks. See A's “Exact conversion rules”, step 11, and `src/frozen-browser.ts:401-406`, `:578-584`. Require timely completion for all four behavioral outcomes **and** `unrelated-failure`.
- Fixed: None. This was read-only.
- Merge verdict: **OK with notes** for the revised contract below. Neither unmodified proposal is implementation-ready.

The working tree is unchanged against reviewer-launch HEAD `9c862a0f0405`. This is a source-backed design review, not a review of a committed diff. No commands, tests, Docker operations, or writes ran.

throughput checkpoint: n/a, read-only investigation

## Decision

Choose A's in-module `admitFrozenBrowserReport(expected, value: unknown)`.

Graft B's strict own-data validation. Do not adopt B's new report module, trusted configuration descriptor, configuration-calculation extraction, or full containment-rule extraction.

The consumer gets a detached scenario observation or a blocked report. The maintainer inherits one new boundary beside existing parsers, with classification shared rather than copied. No caller gets permission to execute, persist evidence, or advance a case.

| Choice | Judgment |
| --- | --- |
| In-module pure helper | Accept. It can reuse the existing private parsers and classifier. |
| Distinct behavioral/blocked union | Accept. It cannot be mistaken for `CheckExecution`. |
| Unknown report input | Accept, with strict validation before property reads or serialization. |
| Narrow consistency validation | Sufficient for this unwired unit, with explicit limits. |
| Full claimed containment validation | Not required for this contract. Do not claim it occurred. |
| Trusted report-contract descriptor | Defer. Independent request and configuration-digest expectations suffice here. |
| Controller integration or native receipts | Exclude. Durable ownership and settlement remain unresolved. |

## Precise implementation contract

### Public data shape

Export the expectation type, admission type, and synchronous function from `src/frozen-browser.ts`.

The expectation has:

- `configurationDigest`, using existing `Sha256`.
- `kind: 'baseline'` with a baseline-role request, or `kind: 'browser'` with a candidate-role request.

Validate that pairing at runtime. Reject checkpoint, unit, regression, and build expectations.

The result has exactly two variants:

- `type: 'behavioral'`, a detached report narrowed to one of the four behavioral outcomes, non-null evidence, `owned-removed` cleanup, `passed`, and exactly one PNG output.
- `type: 'blocked'`, a detached report and one reason from `cleanup-incomplete`, `infrastructure`, `unrelated-failure`, `cancelled`, or `uncertain`. It has no `passed` or `outputs`.

Use A's screenshot label, `Frozen browser screenshot`.

Malformed, contradictory, or mismatched data throws `ControlError('invalid-frozen-browser-admission')`. Do not turn invalid data into a valid infrastructure outcome.

Do not add a candidate identifier, simulated flag, receipt ID, clock, signal, validator instance, workspace handle, storage callback, or production configuration getter.

The function name does not grant controller admission. Document that limitation beside the public API.

### Strict object boundary comes first

Validate and detach both arguments before using existing parsers, `digest`, `JSON.stringify`, object spreading, or classification.

Accept only bounded JSON-like own data:

- Plain records with `Object.prototype` or a null prototype.
- Dense ordinary arrays.
- Null, booleans, finite numbers, and well-formed strings.
- Enumerable own data properties.

Reject:

- Accessors, symbols, hidden properties, inherited required fields, executable values, exotic objects, cycles, and sparse or decorated arrays.
- Undefined values, bigint values, and non-finite numbers.
- Extra keys on fixed report shapes.
- Comma-key collision substitutes.

Check descriptors without invoking getters. Copy keys without triggering `__proto__` assignment behavior. Bound traversal depth, node count, and bytes before serialization.

If the contract promises not to execute caller code for arbitrary JavaScript input, reject proxies before reflective inspection. Node's `util.types.isProxy` provides a local option. Descriptor inspection alone cannot make that promise because proxies can trap reflection.

Keep these guards local to the new boundary. Do not replace the module's existing `object()` or `exact()` globally.

### Correlation and evidence consistency

After the safe snapshot:

1. Parse the expected and returned requests through `frozenBrowserRequest`.
2. Validate the expected configuration digest and role/kind pairing.
3. Require complete request equality. Include both case identities, action ID, epoch, scenario, role, allowance, revision, and manifest digest.
4. Validate the lowercase run UUID.
5. Reuse the existing outcome, cleanup, and evidence parsers.
6. Require supplied evidence to match `digest(expected.request)`, the expected configuration digest, and the expected frozen tuple.
7. Require safe integer timestamps, exact deadline arithmetic, and `finishedAt >= admittedAt`.
8. Require exit zero and `oomKilled === false`.
9. Validate transfer entries, canonical paths, unique paths, existing file/count/total bounds, and exact agreement with the observations' manifest.
10. Validate canonical base64, MIME, size, checksum, and PNG bytes through the existing artifact validator.

Relevant existing rules are in `src/frozen-browser.ts:278-393`, `:430-466`, and `src/artifacts.ts:9-43`.

Do not claim to recompute context, stdout, stderr, build-output, or inspection hashes without their preimages. Validate their formats only.

Do not recompute the workspace manifest digest from the transfer manifest. The workspace digest includes fields absent from the transfer entries. See `src/workspace.ts:198-202`.

A report without evidence has no report-side configuration digest. Valid non-behavior reports with null evidence may still return blocked. They establish no configuration match beyond their echoed request.

### Share scenario semantics

Reuse `classify()` directly. Do not reproduce its mapping in another implementation.

Move the existing stage, literal, and event validation into a small private helper used by both `observations()` and admission. Preserve its behavior:

- Stages are `startup-failed`, `action-failed`, or `complete`.
- Complete observations have a bounded string literal. Other stages require null.
- Events have exact `kind` and `text` fields.
- Existing event count and text-byte limits remain unchanged.
- Ordinary console messages are allowed. Console and page errors prevent behavioral classification.

These rules currently live at `src/frozen-browser.ts:964-978`. Classification lives at `:1025-1043`.

Require evidence, matching classification, and `finishedAt <= deadline` for:

- `baseline-reproduced`.
- `baseline-not-reproduced`.
- `candidate-passed`.
- `candidate-failed`.
- `unrelated-failure`.

For infrastructure, cancellation, and uncertainty with retained evidence, validate the evidence's structure and consistency without promoting the outcome. Do not require those outcomes to equal the retained scenario classification. Cancellation can legitimately replace a previously observed result before commitment. See `src/frozen-browser.ts:1804-1814`.

### Disposition follows validation

Validate the entire report before choosing a disposition.

Then apply this order:

1. Reject evidence paired with `not-needed` cleanup.
2. Return blocked `cleanup-incomplete` for valid incomplete cleanup, regardless of the recorded outcome.
3. Return the corresponding blocked reason for infrastructure, unrelated failure, cancellation, or uncertainty.
4. Require `owned-removed` cleanup for a behavioral result.
5. Set `passed` only for `baseline-reproduced` and `candidate-passed`.

Baseline pass means reproduction. Candidate pass means this scenario observed B. Neither means a Sentry issue stopped or a general test suite passed.

Repeated calls return equal values without shared mutable objects or output bytes. Blocked reports may retain evidence for diagnosis, but never expose admitted outputs.

## Containment validation is not part of this unit

Explicitly narrow consistency validation is sufficient because the output remains unwired and grants no authority.

The existing validator has three distinct responsibilities:

| Responsibility | Relevant code |
| --- | --- |
| Parse retained evidence and validate PNG integrity | `src/frozen-browser.ts:308-393` |
| Verify recorded provenance against trusted assets and private intent | `src/frozen-browser.ts:395-584` |
| Verify actual applied settings, protocol, and worker observations | `src/frozen-browser.ts:907-1024`, `:1740-1759`, `:1820-2002` |

Do not present the new helper as equivalent to the latter two responsibilities.

The following report fields may remain bounded, detached claimed data rather than semantically verified containment evidence:

- Trusted-asset, policy, engine, and base-image records.
- Applied Docker configuration.
- Process census and namespace witnesses.
- Sandbox text, budgets, and restriction observations.

Validate the shapes consumed by conversion. Preserve other `ObjectValue` fields as bounded JSON-like records without claiming to verify their meaning.

This is narrower than B's success criterion 6, which requires shared containment-claim validation. That criterion does not fit the selected scope and must be removed from the implementation specification.

The documentation must state:

- Matching digests prove consistency with supplied expectations, not authorship.
- The helper does not verify containment, resource ownership, cleanup execution, or complete process history.
- A copied `owned-removed` value remains a report claim.
- Retained opaque provenance is not sanitized or attested.
- `passed` describes scenario classification only.

Even a reported unsafe setting can pass this **narrow** converter if it is outside the documented checks. A test should make that limit explicit. If accepting such data is unacceptable to the intended consumer, that consumer requires a stronger verifier in a separate reviewed unit.

The configuration digest does not remove this distinction. Its current calculation depends on trusted assets loaded during `FrozenBrowserValidator.open`. See `src/frozen-browser.ts:1107-1154`. Do not add asset reads or a configuration descriptor merely to support pure fixture callers.

## Bounded scope and acceptance

### Allowed changes

- `src/frozen-browser.ts` gains the types, public helper, local own-data guard, and small private scenario-rule sharing.
- `test/frozen-browser-admission.test.ts` gains direct synthetic tests.
- `docs/frozen-browser.md` documents the unwired contract and validation limits.

Normal work-log and decision-record updates can record the completed unit. They must not claim controller admission, runtime containment acceptance, or M2 completion.

Leave controller, native, domain receipts, artifact persistence, production main, HTTP, workspace ownership, worker assets, Rust, dependencies, and schemas unchanged.

A focused source search found no production import of the existing validator. Preserve that state.

### Required tests

Cover:

- All four behavioral mappings with complete expected results.
- Unrelated literals, failed stages, page errors, console errors, and allowed ordinary console messages.
- Every request and evidence correlation field independently mismatched.
- Unsupported kinds and invalid role/kind pairs.
- Invalid deadline arithmetic and late completion, including unrelated failure.
- Every outcome with incomplete cleanup.
- Missing required evidence and evidence with `not-needed`.
- Cancellation retaining B without promotion.
- PNG integrity, canonical base64, size limits, duplicate paths, and manifest disagreement.
- Hidden keys, symbols, getters, serialization hooks, prototypes, proxies, array decorations, cycles, and traversal limits.
- Input/output mutation and repeated conversion.
- A fabricated report that satisfies narrow checks without establishing execution or containment.
- Existing controller rejection of non-simulated receipts.

Direct admission tests need no workspace, subprocess fixture, database, or Docker. Existing fast validator tests should still cover unchanged runtime parsing and classification.

The supervisor should run:

- `node --test test/frozen-browser-admission.test.ts test/frozen-browser.test.ts`
- `node --test test/check-dispatch.test.ts test/controller-workspace.test.ts test/evidence.test.ts test/artifact-resources.test.ts`
- `npm run verify`

The default test glob excludes Docker integration tests, as recorded in `package.json:10`.

## Remaining blockers

There is no need to solve durable cleanup correlation before implementing this pure contract.

It remains a blocker to **wiring**. Before execution or native receipts, separately resolve durable action-to-run association, owned recovery lookup, cleanup reconciliation, cancellation drainage, late results after Retry, real candidate semantics, suite configuration compatibility, and native persistence recovery.

Current native code still requires simulated receipts and derives persisted origin from the case. See `src/native.ts:436-475`. Relaxing that guard is not part of conversion.

Boundary Discipline kept unknown-data validation at the new boundary. Model the Domain selected the behavioral/blocked union. Type System Discipline kept malformed input and unsupported role/kind pairs outside valid results. Laziness Protocol kept configuration loading, controller integration, and containment extraction out of this unit.