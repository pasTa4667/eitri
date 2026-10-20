# Worker recovery evidence audit

reviewed by anthropic/claude-opus-5-5. The work being audited was done by openai-codex/gpt-6.1-sol, so this is a cross-family review.

## Verdict

**ISSUES.** None of them block the work. They are wording and provenance corrections to the pending docs only. The code, the scope, the protected bytes and the parent's full verification all hold up. The SIGKILL tests are real kills, not simulations. I found no invented runtime claims.

I audited HEAD `447f0d07e038d174b1ceed430e42188f1b8b3485`. The staged pending docs had `git diff --cached | shasum -a 256` = `4958b509…20fb6`. The parent edited `baseline.txt`, `mode-red.txt` and `verification.md` while this audit was starting (transcript lines 160 to 164, 10:51:58Z to 10:52:21Z). I audited the bytes as they stood after those edits.

## Flags (smallest correction for each)

1. **The red and green logs are not tied to the commits they are credited to.** This is in `verification.md` line 23 ("Test-only commit `a3c31a6` reproduces… The red run reports…") and table line 28 ("after the source correction").
   - The worker wrote `.audit/worker-recovery-mode-red.log` at 10:31:46Z. That is 14 seconds before `a3c31a6` was committed (10:32:00Z).
   - `mode-green.log` (10:32:42Z), `mode-journal.log` (10:33:47Z) and `mode-verify.log` (10:40:16Z) all come before `27f56f1` (10:40:34Z).
   - So all four ran on uncommitted working trees. That the tree bytes matched the commits is the worker's word only. None of the logs records a HEAD or a diff state.
   - `delta-review.md` says "The historical RED state was not independently executed."
   - **Correction.** Add one sentence: "The red, green, journal and worker verify logs are worker runs on the pre-commit working tree. Their identity with `a3c31a6` and `27f56f1` is attested by the worker, not re-executed." Optionally, the parent could run the 25 mode tests at `a3c31a6` in a throwaway worktree and record HEAD.

2. **Decision row `2026-10-20T10:51:23.022236Z worker-recovery-mode-fix` claims more than its evidence shows.** It says "after red and green public regressions". Its evidence is the two commit SHAs plus `delta-review.md`, and that review explicitly did not run RED. No pointer to `mode-red.txt` or `mode-green.txt` is given.
   - **Correction.** Append a superseding row. Its evidence should be `docs/evidence/worker-recovery/mode-red.txt; docs/evidence/worker-recovery/mode-green.txt; .audit worktree log mtimes`. Its result should be "RED 4 pass/21 fail and GREEN 25 pass are worker runs on the pre-commit tree; parent reproduction red on 6d94d00, green on 447f0d0".

3. **"Empty source diffs" is broader than what was checked.** This is in `verification.md` line 35 and the work-log sentence "source diffs remain empty before and after verification".
   - The check was `git diff -- src test worker operator package.json package-lock.json` (transcript line 139). That compares the working tree against the index only. It does not see staged changes or untracked files.
   - The log prints the section headings but not the command.
   - **Correction.** Name the exact command and say "unstaged tracked diff". Optionally add `git diff HEAD` and an untracked-file check next time.

4. **The work log does not say who ran some numbers.** The sentence "Implementation `6d94d00` passes 34 focused tests and 588 Node tests" does not say the 588 run was the worker's. The parent independently ran only the 34. `verification.md` line 17 does label these correctly.
   - **Correction.** Change it to "worker-run 588; parent independently ran the 34 focused tests".

5. **Two process steps are missing from the decision log.**
   - The integration merge at 10:43:04Z came before the delta review verdict (PASS was read at 10:50:07Z). Row `worker-recovery-integration` does not record that ordering. The docs do not claim review came before the merge, so nothing is overclaimed.
   - The copied evidence files were edited after the rows were written: one trailing blank line removed from `baseline.txt` and four whitespace-only lines from `mode-red.txt`. `verification.md` line 37 discloses this, but `decisions.tsv` does not.
   - **Correction.** Append one row covering both, with transcript lines 137 and 160 as evidence.

## What I independently verified

- **Git identity and scope.**
  - `git diff --name-only d932d8c 27f56f1` and `d932d8c HEAD` both list only `src/frozen-browser.ts` and `test/frozen-browser.test.ts`.
  - `git diff --exit-code 27f56f1 HEAD -- src test worker operator package.json package-lock.json` exits 0.
  - The protected-path diff against `d932d8c` (controller, domain, workspace, native, artifacts, http, main, worker, operator, package files, tsconfig, prototypes) exits 0.
  - `git diff --check d932d8c HEAD -- src test` exits 0.
  - `a3c31a6` changes tests only and its `src` equals `6d94d00`. `27f56f1` changes source only and its `test` equals `a3c31a6`. All three commits are still in history.
- **The fix.** `6d94d00..27f56f1` adds `const mode = options.mode` and an `invalid-validator-mode` check at `src/frozen-browser.ts:1347-1348`. Both come before `resolve`, the `owners` registration and the first await. All three uses of the mode (existing-only check, finalize skip, returned handle) now use the local. No `options.mode` read remains. The fix adds no comments or suppressions.
- **No Docker contact in journal-only mode.** Docker is only started in `client()` (`src/frozen-browser.ts:1746`). Inside `open`, the only path that reaches it is `finalize`, and journal-only mode skips that. `close()` never calls it. The test fixture sets `PATH` to a private `bin` (`test/frozen-browser.test.ts:382-383`), so tests cannot reach real Docker.
- **The kills are real.** `killJournalChild` (`test/frozen-browser.test.ts:1768-1824`) starts a child process. The child pauses itself with SIGSTOP at a SQLite COMMIT checkpoint. The parent then sends a real SIGKILL and asserts the child exited by `[null, 'SIGKILL']`. This covers pending admission and both sides of the recovery COMMIT.
- **The positive control is real.** The sentinel argv log is asserted at test lines 1587 and 1693.
- **The red script and the checked-in script do the same thing.** The `.audit/reproduce-journal-mode.mjs` script and `docs/evidence/worker-recovery/reproduce-mode.mjs` are token-identical once whitespace and trailing commas are ignored. The only change was `oxfmt`, at transcript line 111. I ran both on `git archive` exports:
  - On `6d94d00`, both fail with identical output: both scenarios have `exposedExecution: true` and the files `journal.sqlite`, `owner.json` and `seccomp.json`.
  - On `447f0d0`, both pass with identical output: `unowned-validator-directory` and `invalid-validator-mode`, with no files.
  - These results byte-match `mode-before.txt` and `mode-after.txt`.
  - The empty journal means Docker could not be reached in this reproduction.
- **Copied logs match their sources.**
  - Byte-identical to their `.audit` or worktree originals: `mode-before`, `mode-after`, `final-verify-all`, `initial-parent-focused`, `initial-worker-focused`, `initial-worker-verify`, `mode-green`, `mode-journal` and `worker-final-verify`.
  - The design, candidate-a, candidate-b, judge, source-review, comment-review and delta-review files match their subagent output files byte for byte.
  - `baseline.txt` and `mode-red.txt` differ only by the whitespace edits that are disclosed.
- **The counts in the logs match the claims.**

  | Log | Tests | Pass | Fail |
  | --- | --- | --- | --- |
  | Baseline | 554 Node, 30 Rust | all | 0 |
  | Initial worker focused | 34 | 34 | 0 |
  | Initial parent focused | 34 | 34 | 0 |
  | Initial worker verify | 588 | 588 | 0 |
  | Mode red | 25 | 4 | 21 |
  | Mode green | 25 | 25 | 0 |
  | Mode journal | 34 | 34 | 0 |
  | Worker final verify | 613 | 613 | 0 |
  | Parent `verify:all` | 613 Node, 30 Rust | all | 0 |

  - The red split is four valid controls passing, plus 18 failing subcases and 3 failing parent groups. The failures are genuine assertion misses, such as "Missing expected rejection" and an unexpected `validate` key. They are not crashes.
  - In the parent `verify:all` log, the Rust result line reads "0 failed; 0 ignored". It also shows "Verification exit 0" and the pre-existing future-incompat warnings.
- **The parent verified after the writers finished.** The fix worker finished at about 10:42Z. Its last log was at 10:40:16Z and its commit at 10:40:34Z. The parent then merged at 10:43:04Z and started reproduction plus `verify:all` at 10:43:13Z. The parent made no tool calls until that run returned at 10:49:58Z. No other session files in this project were written after 09:55Z apart from this run.
  - The delta reviewer, a non-writer, ran the 25 tests in the worktree at the same time. That only competes for CPU.
- **The reference doc matches the code.** `docs/worker-recovery.md` claims a narrow `inventory()`/`close()` handle, the `RecoveryInventory` and `RecoveryRun` shapes (`src/frozen-browser.ts:42-80`) and a `structuredClone` snapshot (lines 1589-1620). All of these match the code.
- **The decision log.** The start row at line 136 names this transcript. Rows 137 to 140 each map to real transcript actions: the design read at line 57, the red reproduction at line 97, the fix-worker report at line 132, and the merge plus verify at lines 137 to 140. Their `.audit` evidence paths all exist.

## What I reviewed as logs only, without re-executing

- The 25 mode tests, the 34 journal tests, the worker `npm run verify` and the parent `verify:all`. I did not rerun any test suites.
- The content of the source, comment and delta reviews. The design candidates and the judge's reasoning.
- The single-owner exclusion, configuration-digest gating, protected-file guards and close draining. I checked these against test names and source structure only.

## Honesty checks that pass

- **Cleanup claims.** Recorded runs report `cleanup: 'unresolved'`. Settled cleanup is described as historical, not a live daemon assertion. Journal-only mode does not finalize or retry cleanup.
- **Write behaviour.** The docs say plainly that journal-only opening can write SQLite (hot-journal recovery and the pending-to-recorded change). It is not described as read-only.
- **Stated assumptions.** The trusted-owner model, same-UID hostile writers, power-loss durability and the current-configuration requirement are all named as outside the guarantee.
- **Scope.** The scope is the offline recovery inventory only. Every doc says full controller-worker correlation is incomplete and lists the gates that remain.
- **No overclaimed runs.** No real Docker, services, credentials or inference are claimed. The source review's 200-second timeout is reported as not a full-suite pass.
- **Review families.** The docs say the source, comment and delta reviews all used the GPT family.

## Residual risks

- The red and green states rest on the worker's word (flags 1 and 2). This is mitigated by the reproduction I ran: red on `6d94d00`, whose `src` equals `a3c31a6`'s, and green on `447f0d0`.
- The full suites were not re-executed by this audit.
- The cross-process owner exclusion and trusted-owner limits are assumptions that the docs state, not things that were verified.
- Side effect of this audit: one `npx prettier` call cached prettier 3.9.10 in the user's npm cache. The repo is unchanged. Temporary export directories were removed.

## Attention

- Flags 1 and 2 are the only provenance gaps. Both are fixed by docs or rows alone.
- Flag 3 is the wording behind "empty source diffs".
- Flags 4 and 5 are minor log hygiene.