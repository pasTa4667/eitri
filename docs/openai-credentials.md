# Offline OpenAI credential integration

The offline credential slice in [M4](build-plan.md#current-m4-subscription-access-slices) is implemented in [`src/openai-credentials.ts`](../src/openai-credentials.ts), using Pi AI 1.3.0's public `CredentialStore` and `Models` interfaces. It is not wired into `npm start`, GPUI, case stores or worker dispatch. No login or inference command is exposed. All verification uses synthetic credentials in temporary directories and mocked token responses; no existing credential store is read.

## Storage and identity

`OpenAICredentialStore.open()` defaults to `~/.eitri-oauth/credentials.sqlite`: an application-owned 0700 directory and 0600 SQLite file, separate from the controller catalogue, session stores, repository and worker mounts. An explicit absolute directory is supported for isolated tests; do not use that override to place credentials in case data or execution mounts. Repository ancestors are rejected. Existing unsafe permissions, symlinks, multiply linked files, foreign/corrupt databases and invalid credential shapes fail closed rather than being chmodded, reset or imported.

The auth-only database holds one bounded, versioned state record, not remediation data. It contains a generated UUID installation identity, the last issued OpenAI client ID and at most one OpenAI OAuth credential. Credentials require nonempty access/refresh/client values, a finite nonnegative expiry and the `chatgpt.tokens.use.direct` scope; API keys, other providers and unknown credential fields are refused. Reads return detached values. `list()` returns only provider/type metadata.

`identity()` returns the actual app name `Eitri`, installation UUID and optional issued client ID. Reopen preserves these values. `delete('openai')` clears local tokens while retaining installation/client identity; it does not revoke a remote grant or certify account identity. No claims are derived from the unresolved ID-token contract. The future approved login wrapper must supply this installation UUID through the SDK's `getDeviceId` option and introduce Eitri under its own name. Retention of an issued client does not fix the pinned SDK's returning-browser-registration behavior.

## Transactions, contention and cancellation

Each instance serializes operations through one promise queue. Mutations execute under SQLite `BEGIN IMMEDIATE` through the entire async callback; FULL synchronous DELETE-journal transactions supply atomic persistence without a bespoke lock or rename protocol. Cross-instance/process contention rejects immediately, before invoking a competing mutation, rather than blocking Node during another process's refresh. There is no automatic busy retry or new execution allowance. A caller may explicitly retry later against the then-current stored credential. Close drains queued operations and refuses new ones.

`modify` returning `undefined` leaves the credential unchanged and performs no UPDATE. A callback exception rolls back and propagates according to the SDK contract; storage/validation errors are generic `credential-store-unavailable`. Caller cancellation before execution or before commit prevents an ordinary mutation from committing. Queued store operations check cancellation when admitted; the store does not promise immediate rejection while another callback is still running.

Pi's supported `Models.getAuth()` performs the actual refresh and rechecks expiry inside `modify`. Once refresh starts, the SDK detaches it from the caller's cancellation and bounds it with its own 15-second signal: a cancelled caller stops waiting, but rotated tokens are still committed before another mutation can start. The integration must not discard that mutation or close the store underneath it. This behavior is tested with the real pinned refresh implementation, not a replacement OAuth protocol.

If remote rotation succeeds but persistence fails, no usable auth is returned. The last local committed record remains, but its refresh token may already be invalid remotely. Recovery/re-login requires attention; there is no fallback or claim of exactly-once remote rotation across a crash or storage failure. No kill-at-fsync or real-provider revocation test is claimed.

## OAuth-only boundary

`createOpenAIOAuthAccess(store)` exposes only `resolve({ signal? })`. Its private Models collection registers only OpenAI with its API-key auth handler removed and ambient environment/file resolution disabled. It exposes no provider mutation, model execution, login, other provider selection or per-request API-key override. An absent/invalid credential, rejected/malformed token response, network failure, cancelled wait or storage error becomes the generic `openai-oauth-unavailable`, without a raw provider response or nested error cause.

Successful resolution contains a secret bearer token (the SDK names the transport field `auth.apiKey` even for OAuth). It is controller-private request auth, **not** a paid API-key route or an operator DTO. Never place it in case documents, model messages, GPUI, artifacts or logs. No production path invokes this building block yet. Calling it with a real expiring credential would perform a real token refresh; tests always replace the transport and no real refresh is authorized by this checkpoint.

## Security limits

- File permissions protect against other OS users, not malicious same-UID processes, root or a compromised filesystem/host. Same-UID path-replacement races are not excluded by these Node path checks.
- Credentials are local plaintext protected by permissions, not encrypted by this module. SQLite `secure_delete` is enabled, but deletion is not guaranteed forensic erasure from SSDs, snapshots or backups. Do not copy this store into telemetry or repository backups.
- This is one selected OpenAI credential, not a multi-account/profile manager. No validated identity, live login, callback security, entitlement, model discovery, inference or remote revocation is certified.
- The unresolved [ID-token-validation/identity gate](openai-oauth-compatibility.md) remains the next task. M4 acceptance and browser login remain blocked; occasional manual re-login is not a security waiver.

## Verification

```sh
node --test test/openai-credentials.test.ts
npm run verify:all
```

The 22 focused tests cover private modes, symlink/hardlink/repository refusal, reopened credentials and identity (including another process), local sign-out identity retention, detached values, serialized mutations, cross-process contention, callback rollback, no-op writes, queued/before-commit cancellation, drained close, invalid credentials, corrupt state, injected SQLite write failure, ambient-key exclusion, concurrent rotating-token refresh, cancellation after refresh starts, and rejected/malformed/network/write refresh failures.

TDD first fails for the missing module. The first typecheck then identifies a test-context overload mistake and overly broad test-facing credential types; using `TestContext` and the store's OAuth-only narrowing fixes those errors without suppressions. Author review adds two failing contract checks before fixes: callback rejection identity must survive, and no-op `modify` must not issue UPDATE. Both now pass.

Final `npm run verify:all` exits 0: **1,912 Node tests and 30 Rust tests**, no failures, cancellations, skipped Node tests or ignored Rust tests. TypeScript/syntax checks, lint, formatting and native compilation pass. Existing Rust dependency future-incompatibility warnings remain. Local raw records: `.audit/m4-credentials-red.txt`, `.audit/m4-credentials-review-red.txt`, `.audit/m4-credentials-focused.txt`, `.audit/m4-credentials-verify-all.txt` and its `.exit` file.

## Five-axis author review

No independent-agent or cross-model review is claimed. Final findings: **no unresolved Critical or Important issue within this offline slice**.

| Axis | Reviewed outcome |
|---|---|
| Correctness | `src/openai-credentials.ts:228–287`: transactional update/delete, no-op semantics, rollback and callback-error preservation are covered, including competing-process refusal. `test/openai-credentials.test.ts:250–365`: the actual SDK refresh is exercised with synthetic responses; cancelled waiting does not lose rotated tokens. |
| Readability | One dedicated store and one narrow OAuth resolver; no generic auth framework, new dependency, independent OAuth flow or unrelated refactor. Validation and transaction policy stay local. |
| Architecture | `src/openai-credentials.ts:114–181,306–325`: separate global auth persistence and a private supported Models collection; no controller/session/worker/GPUI credential wiring. The catalogue and case schemas are unchanged. |
| Security | `src/openai-credentials.ts:40–91,306–325`: allowlisted OAuth shapes, private path checks, parameterized credential writes, disabled ambient/API-key auth and sanitized resolution errors. Live ID-token validation is explicitly not declared solved. |
| Performance | One small record, bounded field/state sizes and a per-instance queue; SQLite busy timeout is zero. Async refresh holds a transaction intentionally; a second process fails closed rather than blocking the event loop. No optimization or high-concurrency guarantee is claimed. |

The two Important findings discovered during author review (callback rejection identity and no-op persistence) were fixed with failing-then-passing regression checks. Remaining limits above are explicit boundaries, not claims of live readiness. Stop here before the next M4 identity-contract task.
