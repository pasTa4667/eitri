# Five-axis review: bounded native diagnosis/proposed fix

## Scope and method

Author review under `/skill:review`, against the operator-approved [contract](../../pi-native-diagnosis.md), starting from `663a1cc`. Tests first, then implementation and launcher diff; no independent-agent or cross-model review is claimed. Production `src/`, schemas, auth logic, dependency versions/lockfile, containment/worker recipe, operator and sibling demonstration source are outside this change.

## Findings

No unresolved Critical or Important finding in the bounded implementation after the corrections below. Implementation verification and the single approved genuine attempt pass. Accept only the bounded diagnosis/proposal persistence slice, not semantic correctness, a validated repair, M4 or production approval.

| Axis | Inspection and outcome |
| --- | --- |
| Correctness | `prototypes/pi-native-diagnosis.mjs:5` reuses the ordered read/check policy before deriving case/source/receipt/revision binding. `:18` enforces exact keys/version/proposal-only status, fixed affected path, nonempty byte-bounded text and lists. `prototypes/pi-native-live-child.mjs:224` validates before successful terminal delivery; the parent validates again from persisted native messages at `prototypes/pi-native-live.mjs:364`. The existing harness verifies receipt/history/PNG/source-transfer correlation, both reopen boundaries and exact counters; final reopen has no candidate or phase change. Invalid final output can leave aborted streaming progress, but not a successful assessment. |
| Readability | The new assessment schema/prompt is isolated in one small module. The existing fixed workflow, tool handlers, evidence verifier and native transcript are reused; no configurable workflow engine, new assessment tool or general-purpose report store is introduced. Existing read/check/ack commands keep their contracts. |
| Architecture | Native SQLite remains the sole transcript. `prototypes/pi-native-live.mjs:384` retains the successful diagnosis store instead of copying prose into a second report or catalogue receipt. The case remains Needs attention/`assessment-required`; no `complete_assessment`, production provider selection or source broker authority is added. |
| Security | Final JSON is untrusted data, never executed, used as a path or given phase authority. Fixed-path/evidence checks and tool-free final policy reject expansion. `scripts/test-pi-tool.mjs:226` prints only the launcher's own generated private path after verified success, not child-supplied paths or model text. Existing clean environments, private stores, dedicated-profile ownership and helper disposal remain. Credentials, raw worker output and screenshots are not exported. Successful temporary-store retention is deliberate and documented; OS cleanup/removal limits are not represented as production durability. |
| Performance | Three requests/two tools, no extra inference loop, retry or worker recipe. Only final diagnosis gets a finite 1,200-token cap; existing 60-second helper and 120-second allowance/125-second launcher limits stay. JSON is capped at 16 KiB, individual text fields and lists are bounded, and protocol framing/overall byte bounds remain. No unbounded catalogue query, new cache or dependency is introduced. |

### Corrections during implementation

- Initial full verification stopped at lint on control-regex and unsafe-finally warnings. Replace the control-character regex with explicit code-point validation and move the cleanup-error filter into a promise callback; no lint rule, test or assertion is suppressed. Preserve that failed run separately.
- A foreground full verification was terminated by the harness command's 240-second timeout before completion. Record it as incomplete, not a passing suite; restart with a completion marker and no test deadline/quality-bar relaxation.

## Verification

- RED: the new focused suite fails with missing `pi-native-diagnosis.mjs` before implementation (`.audit/native-diagnosis/red.txt`, `red.exit`).
- Initial GREEN: **38 new fast tests** pass. Focused native/live/read/check/workflow/diagnosis/snapshot suite: **145 passing**, no failures/cancellations/skips (`focused.txt`, `focused.exit`).
- Actual-Docker/synthetic-inference composition initially passes **6/6**: prior check/workflow paths and two new diagnosis success/stale-receipt rejection cases. The new success opens the retained native SQLite after the harness returns, parses the saved JSON and verifies its evidence/Unicode content; invalid final output has no successful assistant terminal. Helpers are reaped, empty homes removed, synthetic profile uncertainty preserved on failure and fixture capture unchanged.
- Final `npm run verify:all`: **exit 0**, **2,409 Node and 30 Rust tests passing**, zero failures/cancellations/skipped Node tests or ignored Rust tests. Lint, formatting, TypeScript/syntax checks and native compilation pass; existing Rust dependency future-incompatibility notices remain. Final actual-Docker composition: **6/6 passing**, exit 0. Logs/status are `verify-all.txt`, `verify-all.exit`, `docker-final.txt`, `docker-final.exit` under `.audit/native-diagnosis/`; 249 executable/dependency/test identities are retained for pre/post-attempt comparison.
- The exact npm help path is tested without `--run`; malformed extra arguments, private/late/nonzero/diagnostic-success launcher frames fail closed. Each final-stream failure keeps raw prose private and disposes its helper.

## Limits and live outcome

The schema validates structure, boundedness and evidence identity, **not the semantic accuracy of a diagnosis or proposed fix**. The prompt intentionally identifies the controlled profile-name task; this is not autonomous issue discovery. No caller inspection, candidate repair/check, broader coverage, hosted mutation, PR publication, production selection or M4 acceptance is implied. Retention is a private temporary probe store, with explicit operator inspection/removal and possible OS cleanup, not a new production retention subsystem.

The approved single genuine attempt on `0773973`, **2026-11-01T13:36:54.559Z–13:37:45.677Z**, exits **0** with **`native-diagnosis-pass`**: three requests/two tools, saved JSON assessment, both reopen boundaries, real receipt/history/PNG, source binding, accounting and disposal. The launcher's generated private store is still present with mode 0700 after closure; only its location is retained locally in `.audit/native-diagnosis/private-store.txt`, not the assessment contents in Git. All 249 executable/dependency/test identities and the fixture capture match before/after. [Finite evidence](native-diagnosis-actual.json) retains the outcome without raw prose, worker output, PNG or credentials. No unresolved Critical/Important finding within this bounded contract; no further inference, sign-in/credential repair, source writes or next slice follows. Only documentation/evidence changes after the verified implementation.
