# Screenshot preparation compatibility fix

## Scope

The screenshot-preparation compatibility gate is fixed on `fix/screenshot-preparation` in `../eitri-screenshot-preparation`. Commit `09dd3372ca5c9966c47800b89cadcb4fc42b3ac7` follows verified process-discovery commit `cdacccc`.

Only the `screenshotPreparation` test helper changed. The driver, validator, Docker policy, resource limits, scenario interface and acceptance assertions are unchanged. The branch is not merged into main. Full validator acceptance and M2 remain open. The operator requested this next step only, so no broader acceptance suite or integration work followed.

## Root cause

The existing observer watched for an added `STYLE` node containing `caret-color`. The pinned Playwright 1.64.1 implementation hides carets by changing inline styles on `input`, `textarea` and contenteditable elements. The synthetic fixture had no editable element. Its trigger could not match screenshot preparation.

The parent copied the installed Playwright source from a newly created, never-started container of the exact local base image. The first individual-file copy failed because this release bundles the source. Copying its `lib` directory exposed `coreBundle.js`, including the original source marker `packages/playwright-core/src/server/screenshotter.ts`. Both inspection containers were removed.

The inspected image is `sha256:57911b2d47725e1d19e25203b82d7c90a3160da1815f78a9c66b42a89dd1ddff`. The bundle SHA256 is `829521b67ed7be90c7d6d6098ff39f2241562d47e4ad7ccab13710924a56001d`. Lines 22719 through 22770 show the distinction between optional screenshot stylesheet insertion and inline caret hiding. The extracted bundle is a local-only scratch artifact at `.audit/playwright-core-lib/coreBundle.js`. It is not committed.

## Runtime evidence

The [original real-Docker reproduction](screenshot-preparation-before.txt) fails in the benign control. Candidate B passes, but its events are empty instead of containing the required marker. That failure stops the test before its oversized console payload runs.

A throwaway [paired prototype](screenshot-preparation-prototype.txt) held the driver and containment unchanged. The old observer produced no events. An editable element with a style-attribute observer produced exactly `screenshot-preparation-observed`. The same observer with a 9000-character console message produced `infrastructure-failed`. The prototype is local-only scratch at `../eitri-screenshot-preparation/.audit/screenshot-prototype.test.ts`. It is not committed or production code. Its observed results are committed in the linked output.

The fix creates a textarea and observes its style attribute. It disconnects and emits the marker when Playwright hides the caret. It then executes the supplied payload. All existing assertions remain unchanged.

A [mutation check](screenshot-preparation-mutation.txt) temporarily removed only the final sticky-failure check from the driver. The repaired test then failed with actual `candidate-passed` versus expected `infrastructure-failed`. This proves the regression exercises the intended late-overflow safeguard rather than triggering before the first check. The script restored the driver in a finally block and verified its exact original contents. Restored SHA256 is `0fcfdc7bca72ad7ef215ebaa4fee0de0060134fd0605978bc6876fb9571c3129`. The mutation instrument is local-only scratch at `.audit/screenshot-preparation-mutation.mjs`. It is not committed. The linked mutation output and the regression test in commit `09dd337` are the durable evidence.

## Verification

The parent ran these commands in `../eitri-screenshot-preparation` against the exact tracked contents committed as `09dd337`.

```sh
EITRI_FROZEN_DOCKER_ACCEPTANCE=1 node --test --test-name-pattern='actual Docker (screenshot preparation|frozen A after B|popup console|dedicated and shared)' test/integration/frozen-browser.test.ts
npm run verify
```

The [Docker output](screenshot-preparation-docker.txt) records 10 passing tests with no failures or skips. It covers the repaired screenshot gate, frozen A after B, protected classifications, PNG and containment provenance, popup console and error capture, overflow, and dedicated and shared worker rejection.

The [Node output](screenshot-preparation-node.txt) records lint, formatting, type checks and all 311 tests passing with no failures or skips. Rust code is unchanged and was not retested. This is scoped verification, not full validator acceptance.

Fresh [source and comment reviews](screenshot-preparation-review.md) found no issues. The parent reread the final diff before committing. No application comments changed. A final Docker listing found no retained `eitri-frozen-browser-*` containers. Tests asserted owned cleanup. Build cache reclamation is not claimed.

## Audit and handoff

A fresh [cross-family audit](screenshot-preparation-audit.md) by `anthropic/claude-opus-5-5` passed. It checked the active session transcript, evidence copies, source identity, mutation and exact committed code. Its nonblocking handoff flags concerned local-only scratch paths, the pending record commit and imprecise corrected timestamps. The parent labeled scratch paths explicitly, appended exact observed timestamps and prepared the record commit. The initial `claude-opus-4-6` audit launch returned a provider 404 before work; the native retry succeeded. No alternate execution backend was used.

The continuation request arrived at `2026-10-19T17:53:42.303Z`. The paired prototype confirmed the cause at `2026-10-19T17:56:13.171Z`. These transcript times supersede the guessed 18:04 timestamps in the earlier decision rows. The log remains append-only.

The isolated worktree uses a local `node_modules` symlink to the main checkout. Both test runs used those installed packages. No dependency, lockfile or Rust code changed.

## Compatibility limit

The trigger depends on the pinned Playwright caret-hiding behavior. The benign control still requires exactly one marker, so a future incompatibility fails instead of silently skipping the overflow check. No fallback or acceptance weakening was added.
