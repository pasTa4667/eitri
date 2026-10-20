# PASS

Recommend candidate A as the implementation base, with two small grafts from B. Parent selection remains pending.

Throughput checkpoint is n/a for this read-only investigation.

## Score table

Scores follow the five criteria in `.audit/check-dispatch-plan.md`, under "Frame and acceptance". Each criterion scores 0 through 2.

| Criterion | A | B | Rationale |
| --- | ---: | ---: | --- |
| Actual action authority and remaining allowance | 2 | 2 | Both validate persisted authority immediately before dispatch, pass bounded allowance, and recheck before evidence admission. |
| Conservative outcome and pause policy | 2 | 2 | Both separate reliable checks from five non-behavior outcomes, persist conservative disposition, terminate the turn, and identify necessary pause/recovery corrections. |
| Small, typed, simulation-honest API | 2 | 1 | A exposes only required identity scalars. B exposes the whole action snapshot, including internal timing and accounting fields. Both retain simulated-only admission. |
| Complete migration without scope expansion | 2 | 2 | Both inventory the existing callers, remove the positional signature, and exclude validator activation, schema changes, and execution infrastructure. |
| Controller-level verification | 2 | 2 | Both cover identity, isolation, expiry, late results, malformed returns, repair preservation, pause, and restart through public Controller operations. |
| **Total** | **10** | **9** | These are design judgments, not runtime measurements. |

Candidate citations below refer to the complete artifacts at the supplied runtime output references.

## Review

- Correct. Both identify the actual missing boundary. Native admits the tool action at `src/native.ts:194–196`, but drops that identity when invoking `host.check` at `src/native.ts:258`. The controller callback bridge also lacks dispatch validation at `src/controller.ts:426–429`.
- Correct. Both keep non-behavior outcomes away from `checkpoint`, whose ordinary failed-check handling changes repair state at `src/controller.ts:540–567`.
- Correct. Both identify real pause hazards. Uncertain settlement unconditionally applies attention at `src/controller.ts:532`. Recovery does likewise for interrupted tools at `src/controller.ts:768` and can replace paused disposition for unsettled native tasks at `src/controller.ts:784–791`.
- Correct. A explicitly acknowledges existing non-atomic evidence persistence rather than promising rollback. Native writes blobs, manifests, and checks separately at `src/native.ts:487–509`.

No issues found.

The remaining choices below require synthesis, but neither package has a demonstrated architectural safety blocker.

## Structural differences

| Decision | Candidate A | Candidate B | Recommendation |
| --- | --- | --- | --- |
| Callback identity | Flat case/action/epoch scalars | Frozen `Action` snapshot | A avoids coupling callback authors to bookkeeping fields. |
| Parser ownership | File-private controller parser | Exported parser in `src/check-execution.ts` | Keep A unless implementation reveals a concrete reuse need. |
| Non-behavior result during pending pause | Immediately persists `paused` | Retains `pause-requested` until execute settles | Prefer B's existing lifecycle path. |
| Unrelated outcome spelling | `unrelated` | `unrelated-failure` | Prefer B's more explicit name. |

See A lines 66–115 and 164–186, and B lines 57–102 and 170–183.

Both independently recommend an envelope and returned union. Their recommended architectures are therefore close, not structurally competing designs. Each does consider a distinct capability alternative. A's alternative returns completion tokens. B's alternative permits completion-side persistence. Both correctly reject the added settlement protocol.

## Selected signatures

Use A's request shape with B's unrelated-failure spelling.

```ts
export type AdmittedCheckRequest = Readonly<{
  caseId: string;
  actionId: string;
  epoch: number;
  kind: Check['kind'];
  remainingMs: number;
  signal: AbortSignal;
}>;

export type CheckExecution =
  | { type: 'completed'; check: CheckResult }
  | { type: 'infrastructure' }
  | { type: 'unrelated-failure' }
  | { type: 'cancelled' }
  | { type: 'uncertain' }
  | { type: 'cleanup-incomplete' };

// Options
check?: (request: AdmittedCheckRequest) => Promise<CheckExecution>;

// RuntimeHost
check(
  action: Action,
  kind: Check['kind'],
  signal: AbortSignal,
): Promise<CheckExecution>;
```

Keep request construction, dispatch authority, parsing, and stop policy private to the controller. Native remains the evidence writer.

The two recommended grafts are:

1. Use B's `unrelated-failure` discriminant consistently in types, parsing, reasons, and tests.
2. Use B's pending-pause settlement policy. Persist the stop reason while retaining `pause-requested`, terminate the tool turn, and let the existing execute epilogue settle `paused`. Preserve that disposition across timeout and recovery.

Do not graft capability tokens, completion methods, or an execution handle.

## Safety and scope boundaries

Implementation approval should retain these acceptance gates:

- Denied dispatch causes zero callback effects.
- Malformed returns and every non-behavior outcome cause zero new checks or artifacts and preserve candidate history and repairs.
- Timeout settlement and restart cannot replace operator pause or an already persisted conservative stop.
- Late results cannot begin evidence admission after authority loss.
- Request freezing uses detached values, not the controller's mutable action object.
- Callback parsing retains existing artifact limits and simulated-only guards.

The local settlement and recovery corrections are required scope, not scope creep. They address verified paths that otherwise violate the requested pause behavior. A general timeout rewrite, workspace lifecycle, real validator mapping, or evidence-schema redesign would exceed this unit.

The callback inventories agree with the inspected callers in `test/evidence.test.ts`, `test/http.test.ts`, `test/crash-worker.ts`, `test/artifact-resources.test.ts`, and `test/recovery.test.ts`.

## Unresolved policy choices

1. **Reliable completed receipts during pending pause.** Both packages preserve existing admission permission. That does not guarantee pause precedence inside ordinary `checkpoint` behavior. For example, a failed baseline can call `attention` while pause is pending at `src/controller.ts:543–547`. Parent should explicitly retain that existing behavior or authorize a narrowly defined adjustment. Do not silently broaden this non-behavior unit.
2. **Partial evidence persistence.** Accept A's stated limitation that already committed evidence is not rolled back. Distinguish that existing limitation from the mandatory rejection of late callback results before admission begins.
3. **Reason vocabulary.** Select one fixed mapping. The packages disagree on names such as `check-not-configured` versus `validation-not-configured`. No persistence-schema change is necessary.

## Verification and verdict

Both complete candidate artifacts and the relevant controller, native, domain, artifact, and test code were read. No edits, tests, Docker, or external actions were performed.

The implementation still requires focused boundary/evidence/resource/recovery tests, `npm run verify:all`, and fresh source/comment reviews.

**Merge verdict is OK with notes for design selection only.** This is not implementation or runtime acceptance.

Principles applied after reading their leaf skills:

- **Model the Domain** favored the exclusive result union over optional failure fields.
- **Boundary Discipline** kept callback parsing at the host boundary and evidence persistence with native.
- **Laziness Protocol** favored A's smaller request and rejected an additional completion protocol.