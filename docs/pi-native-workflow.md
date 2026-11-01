# Bounded live native source-read → protected-check workflow

## Approved scope and acceptance criteria

The operator approves the proposed next integration slice: join the existing fixed source read and protected baseline check in **one native case**, test it, perform five-axis `/skill:review`, make **one** bounded genuine attempt, and stop. This is a delivery/lifecycle workflow, not autonomous diagnosis or remediation.

- Exact opt-in `npm run test:pi-native-workflow -- --run`; help/default performs no capture, profile access, worker execution or inference. No supplied paths, prompts, commands, patches, providers or scenarios.
- Reuse the exact reviewed unpatched 28-input `fixture-profile-v1` baseline, existing managed immutable revision and accepted/consumed worker recipe. Read only `src/lib/errors.js` **from that same captured baseline**, not a second live checkout read. Bind its digest to the worker transfer manifest. The sibling checkout stays unchanged.
- At most **three model requests and two tool executions**, in order: `read_fixture({})`, `run_check({"kind":"baseline"})`, receipt UUID acknowledgement. Advertise only the next permitted tool. Validate prior call/result correlation, order, arguments and bounded result shapes before profile access; reject duplicate, reordered, failed or extra tools and wrong acknowledgement. Source is untrusted data, not instructions. Only the fixed source capture and public receipt metadata reach inference; no raw worker output or PNG upload.
- Use actual native/controller admission and SQLite. Pause after the read result and again after the persisted check receipt and drained worker handoff. Close/reopen/Continue at **both** boundaries, preserve exact messages, usage, remaining allowance, attempt and repair counters, and require no redispatch on passive/final reopen. Verify real receipt, worker history, PNG and same-source digest.
- Keep existing 60-second model/helper and tool limits, 120-second active allowance/child bound, 125-second launcher backstop, resource ownership/cleanup, pinned SDK/worker recipe and containment. The check controller alone uses the existing OrbStack context with a clean fixed environment; inference helpers use separate empty homes and the dedicated Pi-owned OAuth profile.
- Failure stops without retry, automatic sign-in, credential/lease repair or resumed failed work, retaining private native data. Remove only a newly generated successful store after final close/disposal. No source edits, arbitrary generated execution, hosted mutation, publication, deployment, production selection or M4 acceptance.

## Single genuine attempt

On clean reviewed implementation `c9216a3b466c965c1202fade62b73299aa2fce2b`, run the approved command **once**, **2026-11-01T13:10:07.087Z–13:10:50.328Z**. Exit **0**, **`native-workflow-pass`**: three genuine model requests, one fixed source read, one actual protected baseline recipe and receipt acknowledgement, both native Pause/reopen/Continue boundaries, real receipt/history/PNG, matching source digest, preserved allowance/attempt/repair counters and disposal. All **247 executable/dependency/test hashes** match the full-verified identities before/after. The fixture capture remains `d4248bff339806048ec9958ad0a43a4a55719f0a4e357d9ec4d496f14cf02718`. [Finite evidence](evidence/pi-runtime/native-workflow-actual.json) and the [five-axis author review](evidence/pi-runtime/native-workflow-review.md) record bounded acceptance only.

This completes the approved slice and stops. It does not fix the intentional defect or enable diagnosis, arbitrary generated execution, source edits, publication or production dispatch; M4 remains open. No second attempt, sign-in or credential/lease repair follows. Only documentation/evidence changes after the verified implementation; no redundant test rerun is claimed.

## Verification

TDD must cover ordered policy/correlation rejection and the actual installed live helper with synthetic credentials/intercepted SSE, exact CLI opt-in and output/environment bounds. The opt-in Docker composition must join all three synthetic model streams to the real protected baseline recipe and both native reopen boundaries. Full `npm run verify:all` and five-axis review precede the single genuine attempt; implementation verification and live outcome are recorded separately.

Implementation verification passes **26 new fast tests**, **102 focused native tests**, **2,371 Node/30 Rust full-suite tests**, and **4 actual-Docker/synthetic-inference cases** (old check, combined success, failure before the check and wrong acknowledgement after its receipt). No failures/cancellations/skips/ignored tests. The [five-axis author review](evidence/pi-runtime/native-workflow-review.md) records no unresolved Critical/Important issue; no independent-agent audit is claimed. Full output and source identities remain under `.audit/native-workflow/`.

Run the opt-in real-worker composition separately from the fast suite:

```sh
EITRI_FROZEN_DOCKER_ACCEPTANCE=1 node --test test/integration/pi-native-check.test.mjs
```

Existing read and check commands retain their own two-request/one-tool contracts. Their previous successful attempts do not authorize repetitions or certify this combined workflow.
