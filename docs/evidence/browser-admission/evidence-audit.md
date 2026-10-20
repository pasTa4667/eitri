# Browser admission evidence and trail audit

## Review

**Verdict: PASS.** I found no P0 or P1 issues. There are three P2 notes, all of them limits on how the evidence is recorded. None contradicts a claim.

**Scope.** I checked:
- the six new rows in `decisions.tsv`, from the 09:14:16Z `start` row through the 09:37:00Z review row;
- the new "Pure browser report conversion on October 20" section of `docs/work-log.md`;
- `docs/evidence/browser-admission/verification.md` and every file it links;
- the new "Pure report conversion" contract in `docs/frozen-browser.md`;
- `.audit/browser-admission-review.patch`, the parent raw logs, and the baseline logs;
- the active parent transcript `01a15889-...jsonl` only.

I ran no tests, changed nothing and started no agents.

**Git limits.** I read refs and reflogs directly but cannot decompress Git objects. HEAD and `refs/heads/main` are `bd01ff66e71b59c396792eb5120a1cc0e50d4005`. Reflog line 73 records `9c862a0 → bd01ff6`, "Add unwired frozen browser report conversion", at Unix time 1792488595, which I compute as about 09:29:55Z. The commit's file list and line counts come from parent tool output in the transcript, not from my own Git reads.

### Correct

**Timeout handling.** The timed-out baseline is not counted as a pass, and the docs say so accurately.
- Transcript line 30 is the first `verify:all`, which ended with "Command timed out after 200 seconds" (`isError:true`, 200005 ms).
- `.audit/real-report-baseline.txt` has no `ℹ tests` or `test result` summary, so it is a truncated run.
- The rerun (transcript lines 50 to 51, 320980 ms, `isError:false`) produced `.audit/real-report-baseline-complete.txt`. That log matches `docs/evidence/browser-admission/baseline.txt`: 420 Node tests pass with 0 fail, cancel or skip, and 30 Rust tests pass.
- The rerun ended at 09:13:22Z. The worker's first contract question came before 09:18:17Z. So the claim "completed before source edits" holds.
- The decisions row, `verification.md` §Baseline and the work log all label the first attempt as not counted.

**Parent logs match the copied evidence.** `final-verify-all.txt` and `.audit/browser-admission-parent-verify-all.txt` share the same content and timings: 554 tests, 554 pass, 0 fail, cancel, skip or todo, `duration_ms 288196.46275`, and Rust "30 passed". `focused.txt` and `.audit/browser-admission-parent-focused.txt` both show 260 tests and 260 passes at `duration_ms 53881.601167`. The worker logs match their `.audit` sources: 317 focused and 554 full.

**Test counts agree with each other** (my arithmetic on the logs):
- `.audit/browser-admission-direct.log` has 134 new admission tests, and 420 + 134 = 554.
- The parent focused run is 134 + 126 (`browser-admission-regressions.log`) = 260.
- The worker focused run, 317, implies 183 tests in `frozen-browser.test.ts`.

**The parent's commands match the docs.**
- Transcript line 95 runs exactly the five-file `node --test` command listed in `verification.md`, and the tool returned `isError:false`.
- Line 103 runs `npm run verify:all` with a 1200-second timeout, starting at 09:30:12Z after the commit. It returned `isError:false` after 311595 ms.

**Source identity.** I found the command that wrote `source-identity.txt` (transcript line 116):
- `git diff --name-only 9c862a0 bd01ff6` lists only `docs/frozen-browser.md`, `src/frozen-browser.ts` and `test/frozen-browser-admission.test.ts`.
- The protected `git diff` over `src/controller.ts`, `native.ts`, `domain.ts`, `main.ts`, `http.ts`, `workspace.ts`, `artifacts.ts`, `worker`, `operator`, `package.json` and `package-lock.json` is empty.
- `git diff bd01ff6 -- src test` is empty at 09:36:00Z.
- `git remote -v` is empty.
- Line 112 shows `git show --stat` for `bd01ff6`: 25, 207 and 952 lines changed across the three files. The patch hunks agree: docs `@@ -12,6 +12,31`, a 952-line new test file, and `index e1bc85a..0a6c157` for the source.
- `watchdog_diff` currently shows no change to these three files against HEAD.

**The patch matches the documented contract.** I checked each claim against the source and the tests:

| Claim | Where it holds |
| --- | --- |
| Own-data snapshot with proxy rejection before any reflection | patch lines 435-501, `types.isProxy` before `getPrototypeOf` |
| Expected kind/role pairing and full request equality | the `same(request, returnedRequest)` check |
| `unrelated-failure` must meet its deadline and classification | the `observedOutcome` check excludes only infrastructure, cancelled and uncertain; test at test:602 |
| Cleanup that is not complete takes precedence over the outcome | the `cleanup.kind === 'incomplete'` check comes before the outcome `switch` |
| Cancelled B results are never promoted to a pass | test:675 and test:913-920 |
| `inspectionSha256` is format-checked only when present | `Object.hasOwn(p.applied, 'inspectionSha256')`; rejection test at test:558-562; the fixture's `applied: {}` passes at test:922-930 |
| Byte budget is 8 MiB plus 256 KiB | `limits.evidence` (8 MiB) and `limits.control` (256 KiB) at `src/frozen-browser.ts:124,127` |
| Runtime parsing is unchanged | `scenarioObservations` is a pure extraction; `observations()` still calls it and returns `r` (`src/frozen-browser.ts:1165-1183`) |

**No false containment, cleanup or native claims.**
- `docs/frozen-browser.md` §Validation limits says containment, ownership, cleanup execution and process history are not verified.
- The test at test:932-952 shows a forged report passing with `Privileged: true`, `NetworkMode: 'host'`, sandbox disabled and egress allowed. The docs, the work log and the JSDoc all state this.
- The native simulated-receipt check `result.simulated !== true` is still at `src/native.ts:453`.
- The work log and `verification.md` both say there was no Docker dispatch, no controller admission and no native receipt admission, and that the reports are synthetic.

**The decision trail resolves.**
- The `start` row's inherited range matches the first row (2026-10-18T08:03:56Z) and the previous run's last row (2026-10-20T08:57:08Z).
- The contract row cites supervisor request `83fcd41f-...`. Transcript lines 66 to 70 show the worker's question and the parent's reply: "Validate applied.inspectionSha256 as Sha256 only when present."
- Every evidence path in the six rows exists.
- `verification.md` and the decisions rows state that the source and comment reviews ran no tests. `source-review.md` itself says so under "Verification".

### Findings

**Finding P2: `source-identity.txt` does not record its commands or the protected path list.**
- **Where:** `docs/evidence/browser-admission/source-identity.txt`, the sections "Protected source comparison" and "Current executable identity".
- **Evidence:** Both sections are empty, and the file never says which paths were compared. Only transcript line 116 has the command. A reader of the committed evidence cannot tell an empty diff from a command that was never run. The work log's wording "protected runtime, worker, Rust, dependency and schema code" also does not map visibly onto that list. There is no separate schema file; `find **/*schema*` returns nothing.
- **What still holds:** The substantive claim is supported by the "Changed source paths" section, which lists three files.
- **Smallest fix:** Add the exact command, or the path list, to `source-identity.txt` or to `verification.md` §Implemented contract.

**Finding P2: the parent's focused run overlapped the worker's commit, and the worker was still active during the parent's full verification.**
- **Where:** transcript lines 95 to 96, 103 to 104 and 110.
- **Evidence:**
  - The parent focused run went from 09:29:04 to 09:29:58Z. The commit landed at about 09:29:55Z according to the reflog.
  - At 09:28:39Z, line 88 shows HEAD at `9c862a0` with the source still uncommitted.
  - The worker finished only at 09:35:31Z (line 110). The parent's `verify:all` ran from 09:30:12 to 09:35:24Z.
- **What still holds:** The final state is bound. `git diff bd01ff6 -- src test` was empty at 09:36:00Z, and `verify:all` started after the commit. So the 554 + 30 result applies to `bd01ff6` unless the worker edited and then reverted a file during the run. I consider that unlikely, but no artifact rules it out.
- **Smallest fix:** Report-only. Optionally add a decisions row noting that the worker made the commit and that focused tests ran on the pre-commit tree.

**Finding P2: the review patch was generated from the working tree, not from the commit range.**
- **Where:** transcript line 99. The command was `git diff 9c862a0 -- src/frozen-browser.ts docs/frozen-browser.md` plus `git diff --no-index /dev/null test/frozen-browser-admission.test.ts`, run when HEAD was already `bd01ff6`.
- **What still holds:** It equals the commit content by the inference above: the 09:36 identity check, the matching line counts, and today's clean `watchdog_diff` for these paths. It is still not literally `git diff 9c862a0 bd01ff6`. The `index 0000000..54988cb` line for the test file comes from `--no-index`.
- **Smallest fix:** Report-only. To make it exact, regenerate with `git diff 9c862a0 bd01ff6 -- <3 paths>`.

### Merge verdict

**OK with notes.** The documentation and trail claims match the artifacts. The timeout is labeled as not passing. Pre-existing behavior (the evidence, request, outcome and cleanup parsers and `classify`) is separated correctly from new behavior (the snapshot, expectation correlation, deadline and unrelated-failure gating, the optional inspection hash, and the blocked/behavioral union). There are no false claims of live containment, cleanup or native acceptance.

## Attention

reviewed by Anthropic Claude (Claude Code reviewer subagent), checking work done by the openai-codex `gpt-6.1-sol` family.

- **No test run sat between the commit and the full verification.** The focused run tested the pre-commit tree and raced the commit, and the worker's session overlapped the parent's `verify:all`. The 09:36 empty `git diff bd01ff6 -- src test` is the only thing tying the tests to the committed bytes. See the second P2 finding.
- **Who made the commit is not in the trail.** The worker created `bd01ff6` (transcript line 110) while the parent's reviews and tests were in flight. The 09:36:00Z row cites the SHA but not who made it or when.
- **The worker's focused command could not be checked here.** The worker's `node --test ...frozen-browser.test.ts` command appears only in the worker's own session, which this audit did not read. Its 317 count is consistent with 134 + 183 but is worker-reported.
- **Absence of the inspection hash is accepted.** The design judge (`design-judge.md:101`) asked for format validation of inspection hashes. The parent narrowed this to "only when present", in the 09:23:52Z row, so a report without the field passes. This is documented and deliberate, and consistent with the converter's no-attestation scope.
- **"Cross-judge" means judging between the two candidates, not a second model family.** `verification.md` correctly says the reviews use the GPT family. This audit is the only review from another model family.
- **Same-second timestamps.** The three rows at 09:14:16Z (`start`, design, baseline) were logged after the work they describe, which ran from 09:01 to 09:13. The content is accurate, but the timestamps record when the rows were written, not when the work happened.
- **Synthetic-only evidence.** The forged unsafe report passes the converter by design. Any future caller must not treat `type: 'behavioral'` as proof of containment or cleanup.

No principles are cited because I did not read the leaf principle skills this session.