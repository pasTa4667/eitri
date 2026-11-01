# Native crash-boundary committed-progress review

## Scope and root cause

Five-axis author `/skill:review` of the next plan slice after `8374323`; no independent-agent audit is claimed. Investigate the full-suite failure at the former `test/pi-native-boundaries.test.mjs:138` before expanding live integration. No genuine inference or credential access is needed for this lifecycle reproduction.

The earlier oracle assumed that an unreceived successful terminal meant no assistant entry could exist after recovery. Pinned project Pi Durable **1.3.0** intentionally preserves **already committed streaming progress** as an aborted assistant. In `node_modules/@earendil-works/pi-durable/dist/harness/generation.js:266–275`, `convertPartial` copies `live.generation.message` and appends it with `stopReason: aborted`; `streamResponse` at lines 278–329 commits nonempty partials on the default 100 ms throttle. Scheduler fault/orphan settlement invokes this conversion in `harness/live.js:120–162`. `harness/context.js:4,164` excludes aborted assistants from model context. These are inspected local pinned dependency sources, not assumptions about a newer SDK.

The adapter withholds the successful terminal while awaiting its drainage hook (`src/native.ts:196–210`), but forwards progress beforehand. Under full-suite scheduling, the progress timer can commit before the parent is killed; fast isolated execution had hidden that state. The reported entry's tool-call content and usage are consistent with that committed progress, not terminal success or tool execution.

## Reproduction and correction

- `test/helpers/pi-native-crash.mjs:84–103`: hold drainage at both terminal and catalogue-receipt boundaries until the actual native `LiveDoc` contains a committed partial. Poll the native transaction line with a five-second deadline and a yielding 10 ms interval; do not inject a fabricated document or rely on a fixed sleep. Read through the existing test controller's runtime solely in this helper, without adding a production API. Confirm no assistant or tool-result **entry** exists before the kill.
- With only that fixture barrier added, the original assertions fail deterministically at **both** terminal and model-receipt boundaries: **2 pass / 2 fail**, no cancellations/skips. Raw RED evidence: `.audit/native-boundary-partial/red.txt`.
- `test/pi-native-boundaries.test.mjs:138–154`: require the expected action-correlated tool-call partial and exact recovered assistant equality, including usage/metadata/content, with **only** `stopReason` changed to `aborted`. This replaces the disproven empty-transcript assumption; it does not accept arbitrary aborted output or a successful terminal. Admission still requires an empty assistant transcript. No-tool-result/action-result, zero redispatch/effects, exact allowance/attempt/repair/epoch checks, ownership, duplicate intake and identical second reopen remain enforced.
- Focused boundary/live/read regressions pass **59/59**, no cancellations/skips (`green.txt`). No new test count is claimed: existing scenarios now deterministically cover the previously timing-dependent committed-progress branch.

## Five-axis findings

**Critical:** none identified.

**Important:** none unresolved in this slice. The historical failure was a verification blocker worth resolving before further integration, but this reproduction does **not** establish a production crash-safety defect needing a runtime patch. Discarding the partial in production would remove intentionally retained progress/usage rather than fix unauthorized execution.

**Suggestion:** the fixture intentionally accesses the controller's internal runtime map to observe the actual commit. Keep that coupling test-only; do not add a production configuration seam merely to control this test.

| Axis | Assessment |
|---|---|
| Correctness | RED proves the old oracle wrong with actual persisted progress. Exact aborted recovery, absence of pre-kill terminal entries and no tool effects distinguish progress retention from successful completion. Existing accounting and repeat-recovery assertions remain. |
| Readability | The barrier names the real commit and holds drainage rather than blocking the event loop; comments distinguish partial progress from successful terminal delivery. |
| Architecture | Only the shared test crash helper and its boundary oracle change. Controller/native runtime, schemas, provider routing, dependencies and worker/operator implementations remain untouched. |
| Security | Fixed synthetic model data only, generated private test stores and existing IPC/cleanup. No real profile, private failed store, credentials, hosted data, new source authority or live request. An aborted proposed tool is not treated as executed. |
| Performance | Two test-only yielding waits, bounded at five seconds each within existing 20-second per-case timeouts; no production overhead or new dependency. |

## Full verification

Fresh `npm run verify:all` exits **0**: **2,324/2,324 Node tests**, no failures/cancellations/skips, and **30/30 Rust tests**, no failures/ignored tests. TypeScript lint/format/type/syntax checks, Rust lint/format and native compilation pass. Existing dependency future-incompatibility notices for `block` and `proc-macro-error2` remain. The full suite includes all four boundary cases passing under its normal scheduling. Log and numeric status: `.audit/native-boundary-partial/verify-all.txt` and `verify-all.exit`. Only documentation is updated after that run.

## Disposition

Accept only this crash-boundary diagnosis and deterministic regression correction with the full verification above. Preserve the earlier live fixture-read success; do not repeat it to debug this synthetic failure. Broader restricted tools, production selection and M4 acceptance remain separately scoped. Stop after this slice.
