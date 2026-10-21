# Controller consumed-report conversion verification

## Accepted source

Source commit `4be6022fa42f2bb443ae50694237f6b64bafc08b` adds the offline `Controller.inspectWorkerConsumedAdmission` query. Its base is `411072d5b30d878848491166756928be535e0117`.

The query immediately captures one historical observation, including independent controller-retained pins. It constructs the converter expectation from those pins only. Its refined union preserves nonconsumed states and distinguishes unsettled history, unavailable pins, and converted behavioral or blocked observations. The original historical reader is unchanged. The outer promise participates in controller close drainage.

Two read-only designs compared public-query composition with a shared private reader. A fresh GPT cross-judge selected composition because detached pure conversion needs no queue ownership. The implementation keeps historical guard and closure failures ahead of conversion.

## Executed checks

The parent ran `npm run verify:all` in `../eitri-controller-consumed-admission` against the final source and test bytes. Exit code was 0. All 1,075 Node tests and 30 Rust tests passed. TypeScript lint, formatting, type and syntax checks, Rust Clippy, and Rust formatting passed. There were no failed, cancelled, skipped, or ignored tests. Existing Rust future-incompatibility warnings name `block` and `proc-macro-error2`.

The raw parent log is retained locally at `.audit/controller-consumed-admission-final-verify-all.txt`. Its exit record is `.audit/controller-consumed-admission-final-verify-all.exit`.

After local fast-forward integration, the parent ran `npm run check` and `node --test test/controller-worker-consumed-admission.test.ts` in the main checkout. Both passed. The composition suite passed all 28 tests. Logs are `.audit/controller-consumed-admission-integrated-check.txt` and `.audit/controller-consumed-admission-integrated-focused.txt`.

The writer separately passed 183 focused tests. [Writer checks](writer-checks.md) retain its commands, corrected test-instrumentation failures, and TypeScript call-site probe. An early parent baseline verification timed out and a later baseline run was stopped after detecting the wrong working directory. Neither is counted as candidate verification.

## Independent review

The fresh [GPT correctness review](code-review.md) found no issues. A separate [comment review](comments-review.md) required no deletion or suppression changes. All delegated roles used `openai-codex/gpt-6.1-sol`. Independence is by context, not model family.

The first correctness reviewer timed out while waiting for identity evidence unavailable through its read-only tools. It produced no verdict. The replacement reviewer received parent-computed identities up front. The parent rechecked them before committing and after integration.

The raw stdout of `git diff 411072d 4be6022 -- src/controller.ts docs/controller-worker-history.md docs/consumed-admission.md` has SHA-256 `d38b0da10e4a9c69a9cf4fd31fd9da4bf6d2a0c256d141e1534e46a31deaaf5c`.

The entire `test/controller-worker-consumed-admission.test.ts` file has SHA-256 `c436e8f8903a90c546d5a36e09646fd6dd10c39267154ff8c97d890e709b183c`.

## Evidence limits

Tests use temporary controller and worker SQLite stores. Behavioral literal-report tests replace the detached historical-selection boundary and assert literal decoded PNG bytes. Matrix, diagnostic, mismatch, attribution, queue, close, and storage-failure tests acquire real temporary journals. Existing regression suites include scripted local worker effects. No actual Docker containment or monitored fixture validation was performed.

Matching pins establish consistency, not authorship, containment, executed cleanup, current authority, or daemon quiescence. Partial execution-fact retention remains unchanged. Missing pins are not backfilled. No schema, dependency, worker, production main, HTTP, native UI, or containment changes occur. No native receipt, credential access, service activation, application inference, remote publication, or deployment is enabled. Native real-check admission, actual fixture validation, and M2 acceptance remain separate work.
