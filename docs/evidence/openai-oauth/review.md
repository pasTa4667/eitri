# Five-axis author review

**Verdict: approve the offline compatibility prerequisite only. M4 remains blocked.** This is an author review, not independent-agent or cross-model assurance.

## Findings

- **Critical:** none in this change.
- **Important:** the reproduced upstream registration and ID-token gaps block application login, as recorded in [the compatibility contract](../../openai-oauth-compatibility.md). They are not fixed or waived by this prototype. Resolve them through a reviewed SDK/dependency decision before implementing login.
- **Suggestion applied:** `prototypes/openai-oauth-compatibility.mjs:97` and `:100` check the specific state and plan-scope error causes, not any arbitrary rejection. A broken probe must return `probe-error`, never masquerade as an observed SDK gap.

## Axes

| Axis | Reviewed boundary and result |
|---|---|
| Correctness | `test/openai-oauth-compatibility.test.mjs:23` asserts the exact blocked observations; `:63` injects a transport-response failure and requires distinct sanitized output/exit status. These characterize known SDK behavior, not desired application behavior or OAuth certification. |
| Readability | One disposable sequential experiment and one subprocess test helper; no generic auth framework. The explicit malformed token and report explain why successful SDK login is not sufficient. |
| Architecture | Only `prototypes/`, tests, documentation and an opt-in npm command change. Production main/controller, dependencies, lockfile and Rust are unchanged. |
| Security | `prototypes/openai-oauth-compatibility.mjs:37` and `:48` install synthetic listener/fetch transports before loading Pi. In-memory synthetic credentials and a disabled auth environment avoid existing credential reads. Output omits tokens, auth URLs, PKCE material and raw errors. This is not malicious-dependency containment. |
| Performance | Four bounded synthetic login attempts and one refresh; no model turn, browser, real listener, retry loop or network request. Regression subprocesses have a 15-second limit and bounded output. |

`npm run verify:all` exits 0: **1,890 Node tests and 30 Rust tests pass**, with no failures, cancellations or skips. Lint, formatting, TypeScript/syntax checks and native compilation pass. Existing Rust dependency future-incompatibility warnings remain. The prototype's separate exit 1 is the expected blocked result, not a suite failure.
