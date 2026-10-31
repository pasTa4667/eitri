# Dedicated-profile login — five-axis author review

## Scope and verdict

Review the login-only implementation authorized after the operator's explicit approval, against the [sign-in contract](../../pi-profile-login.md) and [current M4 plan](../../build-plan.md#current-m4-subscription-access-slices). This is an author review using `/skill:review`, not an independent-agent or cross-model audit.

**No remaining Critical/Important implementation finding within the bounded login-only contract.** Actual operator-present sign-in remains an **Important acceptance gate**, not a passing synthetic test. The implemented command does not complete M4 or select a production inference route.

## Findings

- **Important — fixed:** the original one-shot signal handler could be removed before the installed SDK dependency `signal-exit` examined listeners, causing SIGINT re-signaling rather than orderly cancellation. `scripts/test-pi-login.mjs:25–28` keeps handlers installed through cancellation. The real installed SDK/mock-transport cancellation test first reproduced termination by SIGINT, then passed after the fix; denial, browser error, hard timeout and hung exchange remain fail-closed.
- **Important — acceptance still pending:** `docs/build-plan.md` leaves actual dedicated-profile eligibility unchecked. Run the approved command in an operator-present terminal and record only the terminal verdict/exit status. Browser callback success precedes token exchange and is not sufficient. No real home/auth file, login, browser or network was used during this implementation's verification.
- **Suggestion / future production gate:** `prototypes/pi-profile-login.mjs:32–36,72–93` intentionally refuses version-1 native leases, pending records and interrupted recovery. A native controller PID alone cannot prove helper exit. Real native dispatch is disabled; do not widen recovery or use synthetic adapters with real credentials without a separate integration design.

## Five axes

| Axis | Assessment |
|---|---|
| Correctness | Review tests first: 27 focused checks exercise fresh/repeated installed-SDK sign-in, reopen, finite verdicts, cancellation/errors, explicit dead-login recovery, actual SIGKILL and live-owner exclusion. `prototypes/pi-profile-login.mjs:64–100` keeps uncertainty blocked until fresh sign-in succeeds. Re-login reads no case/control state. |
| Readability | Separate the login-command lifecycle from the private profile/lease boundary. Fixed argv/provider/path and finite verdicts avoid configurable auth frameworks. Comments explain signal-exit ordering, ownership and deliberately unrecoverable gaps. |
| Architecture | `scripts/test-pi-login.mjs:43–58,107–110` uses the public installed ModelRuntime login/file store and metadata API. No custom OAuth/store, internal AuthStorage import, agent session, RPC prompt, provider dispatch or production/controller modification. Project dependencies and lockfile are unchanged. |
| Security | `scripts/test-pi-login.mjs:141–165` re-execs with a fixed environment and temporary HOME/cwd. `prototypes/pi-profile-login.mjs:15–30,40–61` validates ownership, modes, links, size and fixed paths. Metadata rejects API-key/foreign entries before resolution; browser origin/path/redirect are allowlisted, provider errors/URLs/credentials never printed. Explicit recovery requires a known dead login owner and never signals a PID, deletes a store lock or recursively deletes a lease. |
| Performance | One login, one selected-provider synchronization and one metadata reopen; no retry loop, background catalogue refresh or inference. Five-minute hard lifetime and ten-second browser-opening bound. Slow/uncertain ownership parks rather than polling/retrying tokens. |

## Verification

- RED: `test/pi-profile-login.test.mjs` first fails on the missing module (`.audit/pi-profile-login/red.txt`).
- Synthetic SDK RED initially exposes an incomplete HTTP fixture, then a real metadata-field mismatch (`provider` vs public `providerId`); the corrected fixture provides `address()` and GET semantics. `.audit/pi-profile-login/red-metadata.txt` preserves the focused behavioral failure. These are local test/implementation failures, not hosted OAuth failures.
- `.audit/pi-profile-login/green-sdk.txt` preserves the SIGINT failure; `.audit/pi-profile-login/green-reviewed.txt` records all **27** focused tests passing after correction, with no failures/cancellations/skips.
- Final **`npm run verify:all` exits 0** (`.audit/pi-profile-login/verify-all.txt`, `verify-all.exit`): **2,192 Node tests and 30 Rust tests pass**, zero failures/cancellations/skipped Node tests or ignored Rust tests. TypeScript/syntax, lint, formatting and native compilation pass. Existing Rust dependency future-incompatibility notices remain.
- The final full run includes the final executable changes; only Markdown/evidence documentation is edited afterward. Source identities are retained in `.audit/pi-profile-login/source-sha256.txt`.

## Limits / stop point

`oauth-saved` is only supported-login/persistence evidence, not model/tool entitlement, workspace certification or full identity validation. No automatic inference follows it. Synthetic native lifecycle/crash evidence from the preceding slice is not replaced by the login sentinel check. Arbitrary independent clients using this dedicated profile, malicious same-user filesystem races, power-loss durability, lossless rotation persistence and ambiguous native lease recovery are not claimed. Pause/allowance and production-resource authority remain unchanged.

At this implementation-review checkpoint, the real sign-in verification remains open for the operator. Stop before genuine tool use, production wiring, publication or any later plan task.

## Subsequent operator observation

After commit `16f7814`, the operator supplies terminal verdict `oauth-saved` with `inference: not-performed`, reports browser success and returns to a shell prompt. The [recorded observation](../../pi-profile-login.md#operator-verification) closes the narrow sign-in acceptance gate above. No independent credential read, numeric exit-status capture, real refresh/recovery test, inference or new full-suite run is claimed. Review this documentation-only follow-up for accurate provenance and preserved scope: no Critical/Important issue found. Genuine controlled tool-use approval and M4 remain open.
