# Offline built-in Codex file-profile/native refresh

The operator approves this bounded follow-on to the [in-memory Codex/native composition](pi-native-codex.md): synthetic file-profile refresh and native cancellation/disposal tests only. Real credentials, live inference and production dispatch remain disabled. The [five-axis author review](evidence/pi-runtime/native-codex-profile-review.md) records verification and limits.

## Run and boundaries

```sh
node --test test/pi-native-codex-profile.test.mjs
```

The eleven checks use generated private temporary profiles and real temporary controller/native SQLite. Fixed `codex-profile` and `codex-profile-denied` fixtures require the canonical OS temporary parent and the generated profile-name pattern before lease access. Existing in-memory Codex fixtures still refuse file-profile configuration. Private path/mode/ownership checks and the existing exclusive profile lease remain authoritative.

Before constructing installed ModelRuntime 1.4.0, the child requires exactly one `openai-codex` OAuth entry with fixed synthetic access/refresh/account values. Extra providers, command-valued API keys and nonsynthetic credentials cannot reach runtime construction. No default profile or ambient key is used. The unmodified supported `authPath` implementation owns file storage and rotation; no credential-store/OAuth implementation or dependency upgrade is introduced.

Fetch is replaced before SDK import/construction, with no real network fallback. Only the fixed refresh endpoint and one Codex SSE request per helper are intercepted. The refresh grant/body, rotated bearer/account headers and native tool-result payload are checked. A second admitted model action must reuse the persisted synthetic replacement without another refresh. Pi Durable 1.3.0 remains the sole native transcript/tool loop, and the existing faux-only production guard is unchanged.

A separate trusted fixture IPC handshake carries only `refresh-response` and `provider-request`, at most two checkpoints per helper. Test callbacks cannot be installed through model frames or CLI/case configuration. The first boundary holds the synthetic rotation response before Pi receives/persists it; the second observes saved rotation at the intercepted inference request before returning SSE. These are **not** hooks inside Pi's local write or lock release. Existing ten-second helper lifetimes, caller cancellation, transport limits, action-keyed drainage and owned-resource cleanup remain in force.

## Acceptance and observations

- Normal execution rotates once, reuses the saved login in a second helper and persists the exact Unicode native probe/result in SQLite. Reopen performs no work and preserves the synthetic file and native transcript.
- Pause during admitted refresh lets that model action finish, but denies its proposed tool. Continue receives the recorded error result without replaying the tool or refreshing again. Paused wall time is excluded; allowance, attempt and repair count are preserved.
- Active deadline and cooperative controller close each interrupt both checkpoint boundaries. The helper must be reaped; while home cleanup is held, the action remains pending, no receipt/tool effect occurs and close cannot acknowledge completion. Only after disposal may the existing failure handling finish.
- Interrupted use blocks the profile as `sign-in-required`, including when rotation was already saved. Deadline retains `model-action-timed-out` precedence and the exact exhausted allowance. Cooperative close records `sign-in-required` without any restart redispatch. Repeated reopen and late checkpoint completion cannot renew counters, replay tools or retry uncertain auth.
- A rejected refresh and a throwing trusted checkpoint park without tool use/fallback, preserve the prior synthetic bytes and reap the helper. Concurrent profile use is refused. Private account/error markers are absent from operator projections; auth paths are absent from native requests.

The fixed clock isolates policy/accounting, not inference cost: successful/closed actions in these tests consume zero simulated milliseconds; deadline checks consume exactly the configured 1,000 ms. A 100-second paused/reopen clock advance is not charged. No claim of zero-cost real inference follows.

TDD retains the initial two failing rotation tests. Eleven new checks pass; the combined new/original Codex/profile suites pass **30/30**. A deliberate mutation skipping the cleanup await initially exposed an insufficient microtask-only test observation; adding an asynchronous-I/O observation window makes the mutation fail on premature home removal. The mutation is restored, not shipped.

Full `npm run verify:all` exits **0**: **2,243 Node and 30 Rust tests pass**, with no failures, cancellations, skipped Node tests or ignored Rust tests. Lint, formatting, type/syntax checks and native compilation pass. Existing Rust dependency future-incompatibility notices remain. Raw results/status are under `.audit/pi-native-codex-profile/`.

## Stop point

Only this synthetic cooperative slice is accepted. Killing an interrupted helper may lose usable rotation; the operator-approved [dedicated-profile/re-login contract](pi-auth-ownership.md#disposition) permits parking, not automatic token repair or a lossless-persistence claim. Native/ambiguous lease recovery remains blocked; no lease-reset mechanism is added.

This does not inject faults inside local persistence, demonstrate shared-client safety, add parent-SIGKILL/orphan/expiry coverage for this built-in file-provider combination, or execute restricted-worker/source-edit tools. Earlier separate crash/expiry tests are not relabeled as new combined evidence. Real profiles, live native inference, broader restricted-tool integration, production-route selection, publication and M4 acceptance remain separately scoped gates. Stop after this step.
