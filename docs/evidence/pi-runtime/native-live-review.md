# Five-axis author review: bounded live/native probe

Scope: the operator-approved fixed probe in [the contract](../../pi-native-live.md), against base `af39e0a`. This is `/skill:review` author review, not an independent-agent or cross-model audit. No general production provider, worker/source tools, hosted mutations or publication is approved.

## Findings

**Critical:** none identified. **Important:** none unresolved within this bounded contract.

- **Correctness** — `prototypes/pi-native-live.mjs:93–192` uses actual controller commands and native SQLite, asserts one tool result before Pause, reopens the same store before Continue, verifies exact call/result correlation and the final assistant's echo, then reopens parked work without redispatch. Real monotonic elapsed time, remaining allowance and attempt/repair counts are checked. Sixteen targeted tests cover this path, adverse output, cancellation, launcher framing/environment and no-opt-in behavior. Initial missing-module RED and the first missing-directory reconciliation failure are retained, not labeled passing.
- **Readability** — live entry, credential helper and fixed harness are separate, explicitly named prototype modules. The existing standalone command's launcher is reused, not duplicated. The same finite three-progress sequence is retained; raw model/provider output is not operator output.
- **Architecture** — `prototypes/pi-native-provider.mjs:10–114` extracts the existing admission-correlated test adapter without changing its receipt/drain ordering. Offline tests keep a wrapper fixed to `streamNativeFixture`; the live harness explicitly chooses the separate live entry. Production `src/` and its faux-only guard remain unchanged. **Suggestion / accepted limitation:** native transcript metadata is deliberately aliased through the characterized cross-version seam; the finite live verdict identifies the actual route separately. This is not production-route acceptance.
- **Security** — `prototypes/pi-native-live-child.mjs:13–68` checks the child environment, uses the dedicated profile's existing sole-process version-2 lease, and requires exactly the chosen OAuth metadata before provider registration. Only `probe` is declared to the real model; strict terminal checks reject another tool, multiple calls or extra arguments before native execution. `prototypes/pi-native-stream.mjs:118–214` waits for actual helper closure and owned-home disposal before returning a result. Abort kills/reaps that credential process and leaves its lease blocked; explicit fresh-login recovery is unchanged. IPC disconnect exits the orphan rather than signaling an inferred PID. Fixed native issue metadata and synthetic probe contents are the only context; secrets, auth paths and repository data are not model inputs.
- **Performance** — the existing bounded protocol (64 KiB frame / 1 MiB aggregate / 1,024 frames) is reused. One request per helper, at most two harness dispatches, 60-second helper limits, 120-second whole-child limit and 125-second launcher backstop prevent an unbounded model/tool loop. SDK/parser allocation and server-side token usage are not claimed sandboxed or server-capped. No dependency/cache/concurrency infrastructure is added.

## Operational trade-offs

- Successful probe SQLite is reopened and compared before its generated store is deleted. Failure preserves private native data under the generated `eitri-pi-tool-*` scratch directory; no automatic cleanup/reset/resume of failed work is added.
- A failed command conservatively reports `sign-in-required`, including non-auth verification failures. This finite diagnostic is not proof of an OAuth rejection. Inspect the retained local case only through a separately authorized follow-up; do not retry inference or remove a lease automatically.
- A successful live attempt would not prove real refresh, cancellation, orphan recovery, expiry, arbitrary tools or complete M4 acceptance. Those mechanics have synthetic evidence; no relabeling is permitted.

## Verification

Before live execution, the 53-test combined native/live/standalone/Codex/profile run passes. Full `npm run verify:all` exits **0** with **2,266 Node and 30 Rust tests passing**, zero failures/cancellations/skipped Node tests or ignored Rust tests. Lint, formatting, TypeScript/syntax checks and native compilation pass; existing Rust dependency future-incompatibility notices remain. Logs, exit status and pre-live source identities are retained in `.audit/pi-native-live/`. No real inference has been performed at this pre-live review checkpoint. The only executable-file edit during full verification corrects comments about which process owns native-mode credentials; behavior is unchanged.

## Live outcome / verdict

The one subsequently approved command exits **1** with `sign-in-required`, after one invocation progress marker and before any verified tool result. [Finite actual evidence](native-live-actual.json) records the undiagnosed cause and unknown HTTP-request count. No inference retry, login or lease repair follows. Pre/post-attempt executable hashes match. Failed private native data is retained and is not inspected/exported by this review.

**Verdict:** implementation is a tested, reviewed local checkpoint; **live-native acceptance is not achieved**. No unresolved Critical/Important code defect has been established, but that does not turn the unsuccessful genuine attempt into integration proof. Local diagnostic access or another genuine attempt requires a separate explicit follow-up; production/M4 remain no-go.
