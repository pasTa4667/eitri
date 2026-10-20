## Review

**ISSUES.** One P1 finding in the pinned diff.

HEAD is `7e0284609e75934bd15a37dc5dbd11c2444b3e9b`. Parent independently regenerated the patch, including all six new files, and reported byte equality with SHA256 `009535af60afdfb4e9cf60c1a0b03cc19538a6ea2a85eeed18ddf767907f7746`. Final observed diff statistics remained unchanged. No reviewer edits or nested agents occurred.

- **Correct.** Controller authority covers persisted action equality, epoch, callback lifetime, signal, pause, allowance, readiness, closing, and retained source. Authority is checked again after worker completion and close at `src/controller.ts:1144-1174,1243-1275,1308-1310`.
- **Correct.** Acceptance stages memory, performs lazy transactional migration, and requires literal `true` immediately before synchronous COMMIT without an intervening await at `src/frozen-browser.ts:1831-1905`. Parsing separates execution accounting from bounded acceptance history and checks cross-kind identities at `src/frozen-browser.ts:945-979,1599-1656`. Recovery excludes acceptance from execution and cleanup at `src/frozen-browser.ts:1686-1701,1913-1916`.
- **Correct.** Acknowledgments are detached projections rather than duplicated durable state. Acceptance remains historical, without execution reservation or native evidence. Tests use real SQLite and actual child-process SIGKILL before/after COMMIT, including first migration and lost-result recovery at `test/frozen-browser-acceptance.test.ts:321-373` and `test/controller-worker-acceptance.test.ts:435-492`.

### Finding

**P1. Rejected asynchronous authority guards leak unhandled rejections.**

Locations are `src/frozen-browser.ts:1855` and `src/frozen-browser.ts:1888`.

Both branches discard the guard's returned Promise when rejecting its nonliteral-true value. Calling the raw acceptance-only API with `async () => { throw Error('revoked-async-guard'); }` therefore rejects `accept()` with `worker-authority-denied` but separately emits `unhandledRejection`, even when the caller handles `accept()` correctly. Node's default rejection policy can terminate the process.

Parent reproduced this against the actual fixture. `/Users/felix.langbein/projects/eitri/.audit/acceptance-async-guard-red.txt` records:

```json
{"unhandled":["Error: revoked-async-guard"],"attempts":0,"records":0}
```

The controller's supplied synchronous guard is unaffected. The defect concerns runtime validation promised by cross-judge “Precise grafts” clauses “Reject promises, thenables” and “A denied guard rolls back without poisoning the handle.” Existing tests cover only a fulfilled Promise.

Smallest fix is to observe rejected native Promise returns on the denial path while continuing to reject every nonliteral-true result. Add subprocess regressions for new and existing acceptance keys. Preserve the no-await COMMIT boundary.

- **Merge verdict. BLOCK** for the pinned diff pending this narrow fix.
- Parent's focused run passed all 34 tests, including SIGKILL cases. Full `verify:all` completion was not established.
- **Principles applied.** Prove It Works required reading the red reproduction. Model the Domain guided union/accounting review. Test Behavior, Not Implementation required checking crash and forbidden-effect controls.

## Exact commands

Reviewer ran no shell commands. Parent reported running:

```text
node --test test/frozen-browser-acceptance.test.ts test/controller-worker-acceptance.test.ts
```
