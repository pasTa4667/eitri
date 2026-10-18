## Review

- Correct. The supplied failure is **not a recorded provider dispatch**. `test/evidence.test.ts:116` asserts `c.remainingMs === 0`. The call-count assertions are lines 117 and 120. The failure log reports **1 ms remaining** at line 116, before either assertion or the explicit auth release.

- Finding P2. Timeout and allowance accounting use separate mechanisms. `src/native.ts:112` aborts through `setTimeout`. `src/controller.ts:204–210` deducts elapsed controller-clock milliseconds. Timeout handling enters attention and stops accounting without necessarily consuming the remaining reservation at `src/controller.ts:527–535` and `213–216`.

### Minimal control explanation

A source-derived counterexample, **not an executed reproduction**:

1. Admit a 30 ms action at injected clock `1000`.
2. Let its timer abort while the injected clock reads `1029`.
3. `finishAction` charges 29 ms. `attention` charges zero additional milliseconds, clears `accountedAt`, and leaves **1 ms remaining**.

This proves that timeout does not imply zero remaining allowance under the current implementation. An early timer relative to the floored performance clock is consistent with the observed failure. The log lacks clock samples and the attention reason, so that historical cause remains **unproven**. `Date.now()` only bounds test polling here at `test/evidence.test.ts:34–39`.

### Dispatch protection

After auth cancellation, the SDK abort race rejects and ignores later auth completion at `node_modules/@earendil-works/pi-ai/dist/auth/resolve.js:10–12` and `dist/utils/abort.js:22–43`. Provider dispatch also rechecks status, epoch, remaining allowance, and action ownership at `src/native.ts:165–171` and `src/controller.ts:497–512`.

`faux.state.callCount` counts scripted stream entry at `dist/providers/faux.js:353–356`. It is not live inference. Live providers are rejected at `src/native.ts:103`.

### Verification and smallest next step

- Supplied full run recorded **194 tests, 193 passed, 1 failed**.
- Supplied focused rerun recorded **1 passed, 0 failed**.
- I ran no tests and made no changes. Neither result establishes cross-family assurance.

Keep the failure recorded. In a separately authorized scope, add a deterministic clock/timer control and an auth-entry latch. The existing timeout test lacks that latch, unlike the pause test at `test/evidence.test.ts:45–76`.

If timeout must conservatively consume the admitted reservation, the smallest correction is in `finishAction`, following the existing recovery accounting at `src/controller.ts:761–766`. Do not substitute a longer sleep or assume the rerun resolves the discrepancy.

Fix Root Causes prompted checking the failing assertion before diagnosing dispatch. Prove It Works kept the timer explanation labeled unproven.

- Merge verdict: **OK with notes for this investigation.** No module-caused regression established. Full verification remains failed.