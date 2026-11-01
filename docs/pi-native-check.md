# Bounded live native protected fixture check

The operator explicitly approves connecting native inference to **one existing protected fixture check**, tests, `/skill:review`, one bounded live attempt, and a stop. This does not authorize source edits, publication, production dispatch or M4 acceptance.

## Contract

- Separate exact opt-in: `npm run test:pi-native-check -- --run`. Default/help is effect-free. No model/CLI prompt, path, command, patch, scenario, image, provider or profile selection.
- Reuse native `run_check({"kind":"baseline"})`, controller action admission, managed immutable revisions, accepted/consumed worker handoff, native real receipt and PNG persistence. No new production callback/tool or bypass of phase/evidence rules. The isolated case remains in triage; this verification is not an agent diagnosis or remediation.
- Capture only the existing 28 application inputs from the fixed sibling checkout, through its quiescent-directory/no-symlink/single-link boundary. Require the exact reviewed **unpatched** `fixture-profile-v1` baseline descriptors before journal creation or inference. Never mount the original checkout, `.env`, host home, Docker socket, OAuth state or credentials into the worker.
- The unchanged protected recipe executes the original and protected regression unit tests, production build, and nine real Chromium assertions in the existing offline, non-root, sandboxed ARM64 envelope. Existing engine/dependency-image/asset pins, deadlines, process/output ceilings, provenance admission and owner-only cleanup remain authoritative. No dependency installation, image pull, source edit or arbitrary generated execution. A reproduced latent baseline failure is the expected result; `passed: true` on the baseline receipt means **reproduction**, not a fixed application.
- Exactly two genuine model requests and one protected check on success. The helper advertises only `run_check` with `kind` constrained to `baseline`; it withholds terminal success unless that exact single call is returned. Its second request receives only the correlated public check receipt (IDs, revision, configuration, provenance and artifact IDs), **not application source, raw worker output or PNG bytes**. Reply must be exactly the receipt UUID; acknowledgement is delivery evidence, not certification by the model.
- Request Pause **after native receipt persistence and completed worker handoff/drain**, before the next model admission. Pausing inside the still-live callback revokes that handoff and cannot produce a successful check; the first synthetic Docker test demonstrated that refusal. Do not weaken revocation. Verify the receipt, history and PNG through paused SQLite, close/reopen, Continue with unchanged counters, then verify a final no-redispatch reopen and matching evidence. Remove only the newly generated successful store after closure; failure retains its private store without retry/resume.
- Keep the existing 60-second model/helper and tool bounds, 120-second active allowance/command bound and 125-second launcher backstop. Resource cleanup must complete before receipt delivery. The controller's Docker client alone uses the operator's HOME and fixed `/usr/local/bin:/usr/bin:/bin` PATH to locate the existing OrbStack context. Its environment excludes ambient keys, Docker endpoint/config overrides and proxies. Inference helpers still receive separate empty homes, the explicit dedicated Pi profile, exclusive lease, OAuth-only route and the unchanged clean environment. No worker mounts or shares that HOME.
- No automatic sign-in, auth/lease repair, alternate provider/key, second live attempt, hosted mutation or publication. The inherited generic failure verdict `sign-in-required` alone does not diagnose OAuth; finite model stages and local verification determine what is known.

## Single genuine attempt

On clean implementation `5163b99851ca9d50a25ed63fd0d9db28b59b6297`, run the approved command **once**, **2026-11-01T12:43:04.858Z–12:43:42.372Z**. It exits **0** with **`native-check-pass`**: two requests, one protected baseline recipe, streamed receipt-UUID acknowledgement, actual native receipt/history/PNG verification, Pause/reopen/Continue, preserved counters and disposal. All **19 executable hashes** match before/after. A post-run capture again matches the exact reviewed unpatched 28-input baseline; the original checkout is unchanged. [Finite evidence](evidence/pi-runtime/native-check-actual.json) and [five-axis author review](evidence/pi-runtime/native-check-review.md) retain the result.

Full `npm run verify:all` passes **2,345 Node/30 Rust tests**, including **21 new fast tests**; focused live/read/check tests pass **76/76**. The actual-Docker/synthetic-inference composition passes after correcting the harness's Pause ordering, including a separate clean-environment run. The initial failing composition and full-suite timeout remain distinguished from successful verification.

Accept only this bounded live check delivery/lifecycle result, not diagnosis, repair, a green application baseline, general generated execution or M4/production selection. Stop without another inference/check attempt, sign-in, credential repair, source edit, hosted mutation or publication.

## Verification

Fast tests cover receipt shape, exact check kind, unsupported arguments/tools, wrong acknowledgement, worker refusal/cleanup and cancellation boundaries, missing input refusal, exact launcher opt-in and environment/output controls. They exercise the installed SDK live helper using synthetic credentials/intercepted SSE, not genuine inference.

A separate opt-in integration test combines that synthetic inference with the **actual** existing Docker recipe and real native Pause/reopen/Continue:

```sh
EITRI_FROZEN_DOCKER_ACCEPTANCE=1 node --test test/integration/pi-native-check.test.mjs
```

It must verify unchanged source capture, the one real baseline receipt/PNG and preserved history/accounting. No skipped tests or substituted fake worker acceptance. Full `npm run verify:all` and five-axis author review precede the one genuine attempt. Record finite results separately from implementation completion; no broad tool, production or M4 acceptance follows automatically.
