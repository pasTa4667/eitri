# Review: offline native orphan ownership and reconciliation

Scope: next M4 offline compatibility task after `710471f`. `/skill:review` applies the five axes below. This is an author source/test review, not independent-agent or cross-model assurance.

## Findings

- **Important — fixed:** helper exit alone did not authorize recovery to remove a home while its original controller was still draining. `prototypes/pi-native-resources.mjs:112` now requires the recorded controller PID to be absent before helper reconciliation. The regression at `test/pi-native-resources.test.mjs:150` first failed with “Missing expected rejection” (`.audit/pi-native-orphans/live-owner-red.txt`), then passed after adding controller ownership. The existing negative singleton test still calls the original controller directly; its lock assertion is not weakened to accept the new wrapper's earlier refusal.
- **Important — fixed before final verification:** assertions in provider hooks can be swallowed into expected native error handling. `test/pi-native-orphans.test.mjs:80` collects PID/home observations instead; assertions run outside the provider at line 137. The final transcript must also contain both assistant messages and the exact successful native Unicode probe result, not merely two attempted requests.
- No remaining Critical or Important finding within this bounded offline contract.

## Five axes

| Axis | Review |
|---|---|
| Correctness | `test/helpers/pi-native.mjs:13` gates actual controller open on reconciliation. `prototypes/pi-native-stream.mjs:80` saves the PID before dispatch. Real parent SIGKILL retains a stopped live helper; timeout and pending reopen cannot dispatch. Recovery removes its home, preserves pause/ownership and exact interrupted-action accounting, and uses a fresh action/epoch only when permitted. Repeated reopen retains results without replay. Missing/partial spawn ownership fails closed, not guessed recovery. |
| Readability | One small resource module owns fixed record/path validation, creation and reconciliation. Existing native tests reuse one startup wrapper. No generic supervisor, alternate agent loop or new configuration framework. |
| Architecture | Ownership records contain only resource identity, no conversation or credentials. Pi Durable remains sole transcript/tool-loop owner. Existing drainage and controller accounting are reused; production source, schemas and dependencies are unchanged. |
| Security | `prototypes/pi-native-resources.mjs:17` checks owner/modes/type/link count/size; paths derive only from the selected private root and validated UUIDs. Cleanup uses empty-directory removal, never recursive deletion. Recovery sends only signal 0: live/reused/uncertain PIDs block rather than being killed. Synthetic global-auth sentinels and unexpected SDK files survive refusal. Private single-controller storage is a prerequisite, not a sandbox against a malicious same-user process. |
| Performance | At most 64 ownership entries and 1 KiB per record; asynchronous polling shares one monotonic 12-second helper-wait ceiling. No helper runtime, SQLite/native open or network work begins during reconciliation. Filesystem calls themselves are trusted operations, not forcibly interrupted. |

## Verification

- Initial TDD RED: missing startup export (`.audit/pi-native-orphans/red.txt`); first two actual orphan scenarios then pass.
- A refusal-test setup removed the leaf before linking its root; correct its preservation assertion to inspect the actual retained root/sentinel, not a leaf deliberately removed by setup. No behavior check is skipped.
- Controller-ownership RED/GREEN recorded separately. Native focused suite: **49 passing**, zero failures/cancellations/skips (`.audit/pi-native-orphans/focused-final.txt`). New tests account for 21 of those cases.
- First full verification was interrupted by the command's 120-second tool timeout; it is retained as `verify-all-timeout.txt`, not counted as a passing run. The complete rerun uses a longer tool deadline without changing code or test timeouts.
- Final `npm run verify:all`: **exit 0; 2,140 Node tests and 30 Rust tests pass**, no failures/cancellations/skipped Node or ignored Rust tests. Includes TS/JS lint, formatting, type/syntax checks, Rust lint/format and native compilation. Existing Rust dependency future-incompatibility notices remain. Raw log/status: `.audit/pi-native-orphans/verify-all.txt`, `verify-all.exit`.

## Verdict and limits

Accept this offline orphan-resource step only. Recovery can refuse ambiguous spawn/PID-save state, reused PIDs or nonempty homes and require operator intervention; it never silently proceeds. Tests resume an intentionally stopped orphan so it can observe EOF; recovery performs the actual cleanup before redispatch. Failure-path test cleanup is not counted as recovery evidence. This is not production startup wiring, cross-process singleton enforcement, power-loss durability, shared-file auth or disposal of a pending built-in refresh. Repair-budget parity and separately approved real controlled tool use remain pending; M4 is not accepted. No live credentials, provider requests, Docker, Sentry/GitHub writes, publication or deployment occur.
