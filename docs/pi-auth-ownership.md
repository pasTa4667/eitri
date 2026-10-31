# Pi auth ownership and refresh-disposal design gate

## Disposition

**Operator decision: use a dedicated Pi-managed Eitri profile and accept re-login instead of complex shared-auth recovery for this version.** After the investigation below, the operator explicitly accepts signing in daily, every few days or on every session, and approves the dedicated-profile recommendation. This supersedes the previous requirement to settle shared-user-store concurrency and lossless refresh drainage before proceeding. It does not claim those properties were proved.

- Store Pi-managed OAuth state at `~/Library/Application Support/eitri/pi/auth.json`, with directory mode **0700** and file mode **0600**. Use supported Pi profile/auth-path configuration and supported Pi sign-in. Keep this profile separate from the operator's normal Pi profile; never copy/import existing login tokens or change global Pi settings.
- One Eitri helper/action may use this profile at a time. Independent Pi sessions may keep using their own profiles, but must not share the Eitri profile. Concurrent clients renewing one saved login are out of scope for this version.
- Pi owns token persistence and renewal. Do not build a custom OAuth implementation, credential store or upstream drain API as a prerequisite. If cancellation/crash interrupts renewal, accept possible loss of that profile's usable login: park work as Needs attention / sign-in required, stop dispatch and ask the operator to sign in again. Do not retry uncertain tokens automatically, repair the credential file or switch billing routes.
- Re-login acceptance does **not** waive actual helper termination/reaping, safe native receipts, pause/deadline enforcement, preserved budgets, stale-action rejection or orphan reconciliation. Never describe an interrupted action as successful or reset its allowance after re-login. Credentials stay outside Git, case history/expiry, logs, transport, GPUI and worker mounts/environments.
- GitHub and Sentry tokens remain in **1Password**, loaded only into controller memory as already planned. Do not move rotating Pi OAuth state into 1Password.

### Next-session handoff

The [offline profile/failure-handling slice](pi-dedicated-profile.md) is now implemented and reviewed: explicit private paths, exclusive use, Pi-owned synthetic persistence/rotation, sign-in-required blocking and native lifecycle/crash/expiry checks. The operator subsequently approves implementing and verifying login-only use. The [dedicated-profile login command](pi-profile-login.md) is implemented and reviewed with synthetic tests, including explicit dead-login recovery; native/ambiguous ownership remains blocked. The operator's [actual terminal/browser verification](pi-profile-login.md#operator-verification) now reports `oauth-saved` with `inference: not-performed`. The operator then explicitly approves the [standalone controlled tool-use probe](pi-controlled-turn.md), which passes one actual two-stream/one-tool attempt with captured exit 0. **Stop after that unit**: native live integration, M4 acceptance and production selection need a separate scoped decision. Do not reopen the superseded shared-store/upstream-drain investigation as a prerequisite.

The original decision-only request and offline implementation did not authorize real credential access or sign-in. The subsequent explicit approval authorizes only the dedicated-profile sign-in/recovery step, not inference, production wiring or a dependency upgrade. The operator's new dedicated-profile terminal verdict establishes supported sign-in for this attempt; it is not inferred from the earlier normal-profile success or Enterprise denial. Only the later separate approval authorizes the recorded standalone tool probe; it does not enable native/controller dispatch or later live work. [ADR 0005](adr/0005-retain-durable-inference-seam.md) and the non-auth authority/containment requirements remain unchanged.

## Historical investigation — superseded acceptance requirements

The remaining investigation/source observations are retained as history. Its demands for shared-store concurrency proof, guaranteed rotation persistence and an upstream/custom-store decision are **not current v1 prerequisites** where they conflict with the operator decision above. The SDK limitations remain real; the operator accepts re-login as the recovery trade-off rather than claiming those limitations solved.

## Supported surface and observed implementation

Paths below are relative to the installed `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/` **1.4.0**. They are source observations, not an upstream guarantee for later versions. The tagged upstream [auth-store source](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/src/core/auth-storage.ts) and [auth resolver](https://github.com/earendil-works/pi/blob/v1.4.0/packages/ai/src/auth/resolve.ts) corroborate these observations; project dependencies remain **1.3.0**.

| Evidence | Consequence |
|---|---|
| `docs/sdk.md`, `examples/sdk/09-api-keys-and-oauth.ts`, `dist/core/model-runtime.d.ts:3–20` | Public `ModelRuntime.create` supports `authPath` or an injected `CredentialStore`, with explicit model/configuration controls. The example demonstrates configuration, not safe refresh drainage. |
| `dist/core/model-runtime.js:79–80`, `dist/core/model-runtime.d.ts:38,89–100` | Default construction owns its credential store privately. The declared public runtime has stream/auth operations but no drain/close operation or default-store accessor. |
| `dist/index.d.ts:4,15`, `package.json:14–22` | The package root exports `ModelRuntime` and `readStoredCredential`, **not** `AuthStorage`, `FileAuthStorageBackend` or `AuthStorageBackend`. Only the root and RPC entry are package exports. A class exported from an internal file is not thereby a supported package entry. Absolute/deep imports or reflection into private state are not the solution. |
| `node_modules/@earendil-works/pi-ai/dist/auth/resolve.js:10–12,47–92` | Caller auth resolution races cancellation. Once refresh starts under `modify`, caller cancellation is detached from that lock operation; refresh has its own 15-second signal and persistence follows. Caller settlement does not expose the underlying operation's completion. |
| `dist/core/auth-storage.js:82–161,385–401` | Built-in asynchronous file modification acquires a `proper-lockfile` lock, rereads under it, executes the callback, writes and releases. Lock wait/stale setting is 30 seconds. This supports a serialization hypothesis, **not** demonstrated independent-client safety. |
| `dist/core/auth-storage.js:38–43,145–150,314–326,337–374` | File initialization occurs before locking; writes are synchronous in-place, not atomic rename/fsync commits. Reload can preserve cached data on failure. Neither universal crash-safe rotation nor fail-closed behavior in every read path follows from the locking code. Existing file modes are not repaired automatically. |

The existing runnable `test/pi-stream-auth.test.mjs` / `test/helpers/pi-auth.mjs:237–250` independently demonstrates canceled-caller settlement **before** synthetic rotation persistence. It uses in-memory storage, not the built-in shared file. The native adapter currently sends SIGKILL on cancellation/deadline (`prototypes/pi-native-stream.mjs:54–56,79–80`); its child explicitly forbids refresh (`prototypes/pi-native-child.mjs:49–59`). Keep that adapter synthetic-only.

## Ownership and disposal requirements

A later design must satisfy all of these together:

1. Pi continues to resolve and refresh OAuth inside a trusted stream-only helper. Credential values never enter Eitri transport, catalogue, case files, artifacts or logs. No bearer extraction with `getAuth`, copied store, API-key fallback, second agent loop or target-repository configuration discovery. Missing, malformed, unsafe or inaccessible shared storage must park work; case startup must not initialize or repair the real credential file.
2. Independent clients use the same supported canonical store/locking protocol, proven with distinct processes, **or** the operator explicitly accepts exclusion for the entire ownership interval, including outstanding refresh and crash recovery. One execution slot, absence of a lock at one instant, and a PID scan are not exclusion. No exclusion is agreed here.
3. Cancellation/expiry immediately prevents new model/tool admission. A canceled stream is not successful work. Preserve action/epoch ownership until stream work, refresh persistence, lock release and helper disposal are known complete; only then may the native drainage hook release resources or cleanup remove case data.
4. The 120-second request and remaining ten-minute allowance are not extended silently for credential cleanup. Reserving cleanup time before dispatch, retaining blocked ownership after expiry, or a longer-lived auth owner each needs an explicit accounting/lifetime design and deterministic proof. The SDK's 15-second refresh signal and 30-second lock setting are not a hard end-to-end teardown bound or a safe sleep-before-kill recipe.
5. Parent death during remote rotation can leave uncertain local persistence even after the helper exits. Record only non-secret ownership/uncertainty metadata before effects. Restart must reconcile or park before redispatch; neither stale-lock expiry nor process absence proves successful rotation. Never automatically replay uncertain refresh, delete the shared store/lock, or claim exactly-once token persistence. Re-login, if necessary, is an operator action.

## Alternatives and recommendation

| Alternative | Disposition |
|---|---|
| Keep the current kill-on-cancel helper and wait 15/30 seconds first | Reject: elapsed time is not a persistence acknowledgment; can interrupt a rotated token or overrun allowance. |
| Use a long-lived helper and assume EOF/process exit drains auth | Insufficient: requires explicit pending-work observation, crash handling and bounded ownership. Node process exit is not a persistence receipt. |
| Wrap the built-in backend through `AuthStorage.fromStorage` | Potentially useful upstream, but those classes are not public package exports in 1.4.0. Do not deep-import or patch them here. A public backend wrapper would need to track the **entire** lock/write/release operation, including read reloads, not only the refresh callback or cancel-raced promise. |
| Inject a custom `CredentialStore` through the public option | Supported extension point, but implementing storage/locking for the user's store would change auth ownership and security responsibilities. Not the same as retaining Pi's built-in persistence, not implemented or approved here. Requires a separate reviewed proposal and explicit authorization. |
| Operational exclusion of other Pi clients | Operator decision only; may resolve contention, never pending-refresh disposal or an interrupted write. Not selected. |
| Upstream public built-in-store lifecycle seam | **Recommended next decision:** seek a supported way to observe/drain built-in auth persistence without exporting credentials, or explicitly approve designing an application-owned store. No upstream fix, issue submission, package change or availability claim is made here. |

This recommendation is deliberately not an invented `runtime.drain()` API or a selected production architecture. A supported seam still needs native cancellation/crash proof. If none is available and the operator declines changing store ownership, leave live integration blocked rather than weakening the contract.

## Required offline proof after a design is approved

Use generated private temporary directories, synthetic rotating credentials and fixed intercepted fetches only; never default user paths. The following are acceptance requirements, **not tests added or passed in this checkpoint**:

- Two independent processes contend on one preinitialized synthetic built-in store: one rotation, under-lock reread by the waiter, replacement reused after reopen, unrelated provider entries preserved. Include a canceled lock waiter, independent login/logout conflict, failed reads/writes and compromised/stale locks. Establish the permitted client versions and canonical-path assumptions; do not generalize to arbitrary clients or filesystems.
- Hold refresh response, persistence and lock release separately. Exercise native Pause, active deadline, close and EOF at each boundary. No success/receipt, new admission, capacity release or cleanup may precede the required disposal acknowledgment. Verify actual helper closure, not merely a counter reaching zero.
- SIGKILL the parent before refresh, after synthetic remote rotation and around local persistence; retain a live helper across restart. Demonstrate cleanup/reconciliation-before-dispatch or visible Needs attention with preserved counters and no token replay. Kill the helper during uncertain persistence and prove refusal rather than invented recovery.
- Re-run native allowance, pause/reopen, isolation/expiry and no-fallback checks. Assert test-fixture violations outside SDK error conversion, and use a mutation that releases ownership early to prove the disposal oracle fails.

## Review and verification

The [five-axis author review](evidence/pi-runtime/auth-ownership-review.md) records verification and findings at the investigation checkpoint, before the operator accepted the dedicated-profile/re-login trade-off above. It is historical evidence, not a current instruction to await that already-made decision. The later [offline implementation review](evidence/pi-runtime/profile-review.md) records synthetic profile/failure handling. The subsequent [operator-reported dedicated-profile sign-in](pi-profile-login.md#operator-verification) completes that narrow gate. M4 and live tool-use approval remain open.
