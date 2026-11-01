# Five-axis author review — bounded native protected fixture check

Scope: the operator-approved next slice after `9058b66`: one existing protected baseline recipe, tests/review, one bounded genuine attempt, then stop. This is a direct author review using `/skill:review`, not an independent/subagent review.

## Findings

- **Critical:** none found.
- **Important:** the first actual-Docker/synthetic-inference composition failed because Pause inside the callback revoked the still-live worker handoff (`check-callback-failed`, no real receipt). **Resolved** in `prototypes/pi-native-live.mjs:130–150`: request Pause at `after-check-receipt`, after handoff/drain and receipt persistence, before next model admission. No controller guard or assertion was weakened. The opt-in composition test now verifies one real receipt/PNG, paused and final reopen, one check/two requests, preserved counters and unchanged source. Failed and corrected invocations are separately retained under `.audit/native-check/`.
- **Suggestion:** the inherited generic command failure verdict `sign-in-required` cannot distinguish a worker/infrastructure failure from OAuth. Keep it explicitly non-diagnostic (`docs/pi-native-check.md`); a future diagnostic change should preserve finite output and private evidence rather than echo worker/provider text. Not a live acceptance claim.

No unresolved Critical or Important finding.

## Five axes

1. **Correctness:** `prototypes/pi-native-check.mjs:17–76` accepts only the exact reviewed, unpatched profile baseline before journal/inference work. `:79–91` uses existing admitted acceptance/consumption and requires reproduced baseline plus owned cleanup. Native admission independently authenticates reports, revisions and artifacts. `:145–170` and `prototypes/pi-native-live.mjs:210–286` inspect real persisted receipt/history/PNG across Pause/reopen/Continue and final no-redispatch reopen. `passed` means baseline reproduction, not a fixed application. Tests cover wrong tool/kind/arguments/result, malformed receipt, missing inputs, cleanup refusal and cancellation boundaries.
2. **Readability:** fixture-specific capture/consumption/receipt verification stays in one small module; the existing native lifecycle harness is reused rather than copied. Names distinguish check/read/probe and expected baseline reproduction. No speculative framework or new dependency.
3. **Architecture:** reuse native `run_check` and existing controller/frozen-worker interfaces; no new production tool, native schema, dispatcher route, phase transition or persistence format. `src/`, operator, worker recipe, dependency pins and fixture source are unchanged. The `offline*` configuration names identify the existing isolated workspace/worker seam, not faux inference in the separately opted-in genuine attempt.
4. **Security:** helper filtering and baseline-only schema are at `prototypes/pi-native-live-child.mjs:53–122`; terminal call validation is at `:183–190`. Only public native receipt metadata reaches the second model request—no source/PNG/raw logs. Input hashes, containment, revision, deadline, cleanup, OAuth-only dedicated profile and finite diagnostics remain enforced. `scripts/test-pi-tool.mjs:107–120` allows operator HOME and fixed PATH only in the controller's Docker client environment for the existing OrbStack context; ambient provider keys, Docker overrides and proxies are absent, inference helper homes remain empty, and no home/credential is mounted into the worker. Launcher tests enforce exact environment keys and reject private/diagnostic-success output. No real credentials inspected by the author.
5. **Performance:** at most two model calls, one check, 28 captured inputs, one bounded receipt/PNG, unchanged model/tool/action deadlines and worker resource ceilings. No polling without an abort/deadline, retry loop, installation, pull, unbounded output or new hot-path work.

## Verification status

- RED: missing `pi-native-check.mjs` fails the new focused test before implementation.
- GREEN: **21 new fast tests**; existing native live/read plus new check tests pass **76/76**.
- Actual Docker plus synthetic installed-SDK inference: first failed ordering invocation retained; corrected composition passes, including a separate run under the shipped controller's clean HOME/PATH environment. Both passing invocations verify unchanged fixture capture.
- Full `npm run verify:all` exits **0**: **2,345 Node and 30 Rust tests pass**, with no failures, cancellations, skips or ignored tests; TypeScript lint/format/type/syntax and Rust lint/format/native compilation pass. Existing Rust dependency future-incompatibility notices remain. A first full-suite invocation was interrupted by the tool's 360-second timeout without a test-failure verdict; it is not counted as passing. The complete rerun retains exit `0` in `.audit/native-check/verify-all.exit`, with output in `verify-all-complete.txt`.
- The one authorized genuine attempt remains to be run on these verified bytes; implementation verification is not live acceptance.
