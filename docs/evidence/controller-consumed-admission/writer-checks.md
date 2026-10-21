# Validation commands

All commands ran in `/Users/felix.langbein/projects/eitri-controller-consumed-admission` on `implement/controller-consumed-admission`, based on `411072d5b30d878848491166756928be535e0117`.

| Command | Exit | Log | Result |
| --- | --- | --- | --- |
| `npm run check` after controller change | 0 | `check-source.log` | Controller implementation typechecks. |
| `node --test test/controller-worker-consumed-admission.test.ts` initial unit group | 1 | `composition-unit.log` | Four effects tests captured file baseline before a setup snapshot changed native SQLite shared-memory read marks. Baseline moved after setup snapshot. |
| Same unit command after baseline correction | 0 | `composition-unit-rerun.log` | 15 passed. |
| `npm run check` after first unit tests | 2 | `check-tests-unit.log` | Test mutation assigned directly to readonly selector fields. Changed to explicit test mutation with Object.assign. |
| Same check after test mutation correction | 0 | `check-tests-unit-rerun.log` | Passed. |
| New composition suite after lifecycle additions | 0 | `composition-lifecycle.log` | 28 passed. |
| `npm run check` after lifecycle additions | 2 | `check-lifecycle.log` | Reflect access to private acquisition returned unknown. Added the same narrow test seam typing used in existing history tests. |
| Same check after test seam typing | 0 | `check-lifecycle-rerun.log` | Passed. |
| `npx oxfmt --write src/controller.ts test/controller-worker-consumed-admission.test.ts` | 0 | `format-write.log`, `format-final-write.log` | Only the scoped TypeScript files formatted. |
| Focused four-suite command | 0 | `focused-tests.log` | 183 passed. |
| `npm run lint:ts` initial | 1 | `lint-ts.log` | Removed one unused test import. |
| `npm run lint:ts` after correction | 0 | `lint-ts-rerun.log` | Passed. |
| `npm run format:check:ts` | 0 | `format-check-ts.log` | Passed. |
| `npm run check` | 0 | `check-final.log` | Passed before final unrecorded-acquisition assertion. |
| `npm run lint:ts` | 0 | `lint-final.log` | Passed before final unrecorded-acquisition assertion. |
| `npm run format:check:ts` | 0 | `format-final.log` | Passed before final unrecorded-acquisition assertion. |
| Focused four-suite command | 0 | `focused-final.log` | 183 passed before final unrecorded-acquisition assertion. |

The focused command is `node --test test/controller-worker-consumed-admission.test.ts test/controller-worker-consumed-history.test.ts test/controller-worker-execution-facts.test.ts test/frozen-browser-consumed-admission.test.ts`.

The new suite does not execute workers. Behavioral literal-report tests stub the detached historical-selection boundary while reading real temporary controller pins, to test converter composition without duplicating the strict committed-evidence fixture or invoking workers. Matrix, blocked conversion, independent selector/timing mismatch, attribution, queue, close, and storage-failure tests use real temporary journal acquisition. Existing execution-facts regression tests retain their scripted local executable fixture. No Docker daemon, remote service, credentials, native real validation, or external inference was used.

No full repository test run, Rust checks, live integration, or native acceptance was attempted. Independent review remains required. Final verification after the last assertion is recorded in `verification-final.log`.

## Final verification

`verification-final.log` records exit 0 for npm check, TypeScript lint, format check, focused tests (183 passed), and diff check after the last test assertion. It also records an empty staged-file list.

The sketch's nested-discriminant usage was probed separately. Initial direct-file tsc invocation exited 1 because TypeScript 6 requires `--ignoreConfig`. With that flag it exited 2 because nested `conversion.state` does not narrow sibling pins for `.reason`. The supervisor approved keeping the refined union and requiring the pins' own state check. The corrected usage compiled with exit 0 using `npx tsc --ignoreConfig --noEmit --target ES2024 --module NodeNext --strict --skipLibCheck --allowImportingTsExtensions .audit/call-site.ts`. Logs are `call-site.log`, `call-site-rerun.log`, and `call-site-final.log`. The consumed-admission reference now includes a concise checked usage example. No source shape or runtime policy changed.
