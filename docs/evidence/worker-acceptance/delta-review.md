## Review

### Delta comments and suppressions

PASS. The helper, replaced call sites, subprocess worker, and added tests introduce no comments or lint/TypeScript suppressions. The casts deliberately exercise invalid runtime guard returns at `test/frozen-browser-acceptance-authority-worker.ts:19-27`. No edits or nested agents occurred.

### Correctness and specification

- **Correct.** `requireCurrentAuthority()` accepts only literal synchronous `true`. It observes native Promise rejection without awaiting and rejects every other return value. It does not read or invoke arbitrary thenables at `src/frozen-browser.ts:996-1001`.
- **Correct.** Both acceptance paths use the helper at `src/frozen-browser.ts:1861,1894`. The new-record guard remains immediately before synchronous COMMIT, with no intervening await or caller hook at `src/frozen-browser.ts:1893-1896`.
- **Correct.** Guard denial retains the existing rollback and reusable-handle behavior at `src/frozen-browser.ts:1897-1907`. This preserves the contract in `docs/worker-acceptance.md`, “Authority and persistence.”
- **Correct.** Four subprocess cases cover rejecting async functions and ordinary `Promise.reject()` guards for both new and existing keys at `test/frozen-browser-acceptance.test.ts:110-131`. The worker checks for unhandled rejection after an event-loop turn, unchanged durable history and inventory, and successful subsequent acceptance at `test/frozen-browser-acceptance-authority-worker.ts:12-43`.

The original P1 blocker is resolved for the required cases. The supplied red reproduction records an unhandled `revoked-async-guard` rejection. The green reproduction records `{"unhandled":[],"attempts":0,"records":0}`. Both artifacts were read directly at `/Users/felix.langbein/projects/eitri/.audit/acceptance-async-guard-{red,green}.txt`.

No issues found.

### Standards verdict

PASS for the reviewed delta. The change centralizes the two identical checks without changing acceptance types, persistence format, or authorization timing. The tests exercise the actual acceptance journal and process-level failure behavior.

### Verification and provenance

Read-only source review completed against the original and repaired patch artifacts and actual surrounding source/tests. Parent-supplied hashes were accepted, not independently recomputed.

- Original SHA-256 `009535af60afdfb4e9cf60c1a0b03cc19538a6ea2a85eeed18ddf767907f7746`.
- Repaired SHA-256 `a2519fd14c528472a1d9915ef187d25a9b526d71c228ba2fc366162c56223f12`.

No reviewer shell was available. Parent reports 38 focused tests passing. Final full verification remains unconfirmed here. The earlier 665-test run predates this repair and is not final evidence. The remaining verification command is `npm run verify:all`.

**Principle applied.** Prove It Works changed verification to direct inspection of the implementation, regression assertions, and red/green artifacts rather than relying solely on the worker report.

**Merge verdict. OK with notes.** The original blocker is resolved. Final full verification remains outstanding.
