# Offline auth-ownership design investigation review

## Scope and verdict

From clean `05adf58`, investigate only the next M4 auth-ownership/native refresh-disposal design task. Apply `/skill:review` across correctness, readability, architecture, security and performance. This is an author source/documentation review, not an independent-agent audit or a new runtime experiment.

**Verdict: accept the investigation record only; the design task remains blocked.** No supported built-in-store drain mechanism is established, no operational exclusion is agreed, and no custom-store implementation is approved. Do not mark auth ownership, native refresh disposal or M4 accepted. See the [design gate and alternatives](../../pi-auth-ownership.md).

## Findings

- **Important — unresolved integration blocker:** installed `dist/core/model-runtime.d.ts:3–20,38,89–100` permits injected credentials but keeps the default store private and declares no drain operation. `dist/index.d.ts:4,15` and `package.json:14–22` do not expose the internal `AuthStorage`/backend classes as supported package entries. Merely seeing `export class` in an internal source file is not public API support. Resolve by obtaining a supported upstream built-in-store lifecycle seam or explicitly approving a separate application-owned-store design, followed by offline native drainage proof. No deep import, private-state reflection or SDK patch is introduced.
- **Important — unresolved shared-store proof:** built-in `dist/core/auth-storage.js:82–161,385–401` implements locking and under-lock rereads, but neither source inspection nor the earlier in-memory test proves independent-client safety. File initialization precedes locking, writes are in-place, and cached-read fallbacks exist. The design requires distinct-process synthetic tests or an explicitly agreed operational exclusion; exclusion cannot settle the separate pending-refresh disposal gate. No user decision is manufactured.
- **Suggestion — addressed in the design:** the 15-second refresh signal and 30-second lock setting are not an end-to-end disposal deadline. `../../pi-auth-ownership.md` separates request/allowance authority from cleanup ownership and requires a reviewed accounting/lifetime design. Waiting a fixed interval and killing the helper is expressly rejected; no allowance or teardown contract is silently extended.

These are pre-existing pre-live blockers discovered more precisely, not regressions introduced by this documentation-only change. No Critical finding is identified within this checkpoint.

## Five axes

| Axis | Review and disposition |
|---|---|
| Correctness | The supported public surface is distinguished from internal implementation, source-based hypotheses from runtime evidence, and completed investigation from the still-unchecked design task. Future proof cases are labeled unimplemented. Existing in-memory cancellation evidence is not presented as file-store or native disposal proof. |
| Readability | One focused design gate contains the evidence, alternatives, ownership requirements and next decision. The plan and compatibility entry link to it rather than duplicating an accepted auth strategy that does not exist. |
| Architecture | Pi Durable remains sole loop/transcript owner. Catalogue authority, source/worker confinement, dependency pins and production route are unchanged. A supported injected store is acknowledged as an alternative requiring a separate ownership/security decision, not misrepresented as impossible or already approved. |
| Security | No credential reads, exports, login, hosted mutations or auth implementation changes. Tagged public source retrieval is read-only. The design explicitly rejects copied stores, bearer extraction, API-key fallback, deep imports, guessed rotation recovery and automatic shared-lock deletion. Crash uncertainty stays visible. |
| Performance | No runtime operations are added. The design makes no hard-real-time claim from SDK timeouts or lock staleness; blocked ownership cannot silently become fresh work or an unbounded cleanup retry. No benchmark or throughput claim. |

## Verification

- `npm run verify:all` exits **0**: **2,144 Node and 30 Rust tests pass**, zero failures/cancellations/skipped Node tests or ignored Rust tests. TS/JS lint, formatting, type/syntax checks, Rust lint/format and native compilation pass. Existing Rust dependency future-incompatibility notices remain. Raw log/status: `.audit/pi-auth-ownership/verify-all.txt`, `verify-all.exit`. This verifies the unchanged implementation, not the missing auth composition.
- All **228** local documentation links/anchors in the checked documents, installed public-surface assertions and retained unchecked gates pass `.audit/pi-auth-ownership/check-docs.mjs`; result: `docs.txt`. The check reads installed source/declarations only, never constructs a runtime or accesses a credential file. No runtime test or behavioral RED/GREEN is appropriate for this documentation-only change.
- Recorded executable/dependency/installed-source identities match `source-sha256.txt`; results: `source-check.txt`. Whitespace and protected executable/dependency paths are unchanged. The plan's original auth-design and real-tool approval tasks remain unchecked; no new completed task is substituted for them.
- Author review retains the two Important pre-live blockers, rejects unsupported internal imports and leaves the design decision to the operator. No independent-agent or live entitlement verification is claimed. No verification test command is repeated after success on unchanged executable code.

**Stop for an operator decision after this checkpoint.** The next step is not real tool use: choose whether to pursue upstream lifecycle support or authorize a separate application-owned-store design. Neither path grants real credential access, changes dependencies, or waives independent-client/native refresh-disposal proof.
