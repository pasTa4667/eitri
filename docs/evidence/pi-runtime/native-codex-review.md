# Offline built-in Codex/native composition — five-axis review

## Scope and verdict

Author review using `/skill:review`, not an independent-agent or cross-model audit. Review covers `prototypes/pi-native-codex-child.mjs`, the bounded selection in `prototypes/pi-native-stream.mjs`, `test/pi-native-codex.test.mjs`, the syntax-check addition and associated documentation against the [approved offline contract](../../pi-native-codex.md).

**Approve this offline slice. No unresolved Critical or Important finding.** No live/production provider approval or M4 acceptance is implied.

## Findings

- **Important — resolved before completion:** `prototypes/pi-native-stream.mjs:18` rejects Codex-fixture/file-profile combinations before `withDedicatedProfile`, not inside an already acquired lease. The earlier placement entered the profile boundary before rejecting an unsupported combination. `test/pi-native-codex.test.mjs:21` first failed with `sign-in-required`, then passed with the fixed offline refusal. This prevents the new synthetic fixture from opening/claiming a configured real profile.
- **Critical:** none.
- **Suggestion:** none required for this bounded slice. The limitations below are retained gates, not claims of completed compatibility.

## Five axes

| Axis | Evidence and conclusion |
|---|---|
| Correctness | `test/pi-native-codex.test.mjs:152` covers real controller/native SQLite, distinct admissions, exact call/result correlation, one tool effect, streamed deltas, pause/Continue, preserved allowance/counters and reopen without replay. `:208` covers failed HTTP/SSE/tool-selection outcomes with zero tool effects. `prototypes/pi-native-codex-child.mjs:194` checks one intercepted request, SDK terminal/result equality and the echoed native result before successful close. |
| Readability | The new child is one finite fixture, not a generic provider framework. `prototypes/pi-native-codex-child.mjs:153` names the test-only metadata alias explicitly; the rest of the wire data is preserved/validated. Existing fixture behavior is unchanged. |
| Architecture | `prototypes/pi-native-stream.mjs:58` selects only a fixed child path using trusted fixture names. Existing controller/native admission, tool execution, resource ownership and drainage remain authoritative. No `src/`, worker, operator, schema or dependency-version change, no helper transcript or second tool loop. |
| Security | `prototypes/pi-native-stream.mjs:18` refuses profiles before lease access. `prototypes/pi-native-codex-child.mjs:54` replaces fetch before SDK construction, asserts the fixed endpoint/auth/body and retains no real fetch. `:127` supplies synthetic in-memory credentials only. Environment/path assertions, existing protocol validators and fixed stderr retain fail-closed boundaries. Cancellation checks at `test/pi-native-codex.test.mjs:31` require actual PID absence/home removal before rejection. No real secrets or services are accessed. |
| Performance | One child/request per admitted model action, no retries, bounded existing pipe/receiver limits and 10-second lifetime. Only two normal-path streams and one small native tool result are exercised. No new catalogue scans, unbounded event queues or production hot-path work. No performance improvement is claimed. |

## Verification

- Initial focused RED: five tests fail because the new fixture is unsupported; positive cases have no tool effect and negative cases have no observed start. `.audit/pi-native-codex/red.txt`.
- Profile-boundary RED: the configured file-profile path reaches `sign-in-required` rather than being refused before profile access. `.audit/pi-native-codex/profile-red.txt`.
- Final focused GREEN: **8/8** pass, including both cancellation boundaries. `.audit/pi-native-codex/green.txt`.
- Full `npm run verify:all`: exit **0**, **2,232 Node and 30 Rust tests** pass, zero failures/cancellations/skipped Node tests or ignored Rust tests. Lint/format/type/syntax checks and native compilation pass. Existing Rust dependency future-incompatibility notices remain. `.audit/pi-native-codex/verify-all.txt` and `verify-all.exit`.

## Retained limits

Synthetic HTTP/SSE and in-memory OAuth are not live entitlement, real refresh or dedicated-file-store/native cancellation proof. Successful reopen is cooperative, not new abrupt-parent/expiry evidence for this built-in path. Only the fixed in-process probe executes; no generated commands, source edits, restricted-worker execution or publication. The faux-only native production guard remains unchanged. Stop after this slice; subsequent integration and M4 acceptance need separately scoped work.
