# Validator acceptance evidence audit

**Verdict: PASS.** Nothing I found contradicts accepting the unwired validator at `352bf15`. I flagged two weak claims, one evidence gap and one timing risk below. None of them requires expanding scope beyond the stated synthetic contract.

Reviewed by Claude (Anthropic family), launched as `anthropic/claude-opus-5-5`. The parent and all source reviewers used `openai-codex/gpt-6.1-sol`, according to the transcript's `model_change` line and the subagent `model` arguments. This audit was read-only. I ran no Docker, tests, edits or subagents. I could not compute hashes myself, so hash claims rest on the parent's assertions that I saw execute in the transcript.

**Follow-up guidance.** I read the original parent transcript directly at the line ranges cited below, so I did not need the reduced `.audit/validator-transcript-index.txt`. I read `validator-source-identity.txt` and the record's link to it, and they change no conclusion here.

## 1. Verified claims

| Claim | Status | Evidence | Notes |
|---|---|---|---|
| Full Docker suite passes 20/20 at `352bf15` | supported, high | Transcript: commit `352bf15` at 18:56:11Z. Docker run 19:01:17–19:03:14Z. `rev-parse HEAD` returned 352bf15 at 19:04:31Z, with only `?? node_modules` untracked. `validator-final-docker.txt` matches the run byte for byte. | The log itself does not record the revision. Source identity comes from the transcript plus `validator-source-identity.txt`. |
| Local verify passes 311/311 at `352bf15` | supported, high | Transcript 18:56:31–19:01:08Z. `validator-final-node.txt` shows 311 pass and 0 fail. | |
| `88f8909` changes only docs | supported, high | `validator-source-identity.txt`: `diff --stat` shows only `docs/frozen-browser.md`. `diff --exit-code` over src, worker, test, prototypes and the package files exits 0. | |
| Harness repair `8fe2b81` was committed clean and reviewed | supported | Transcript 18:41:51Z commit, with status showing only node_modules. `validator-harness-review.md` passed for the exact range `09dd337..8fe2b81`. | |
| 13 fixtures, 39 runs, exactly one unknown build with incomplete cleanup | supported, high | I counted the runs in `validator-final-stores.json`: 7+2+4+2+1+1+1+1+1+1+16+1+1 = 39. The single unknown build is in fixture `qClk3V`. The parent's assertion script ran at 19:04:49Z. | |
| All four diagnostic commands pass against the final source | supported | Transcript 19:03:35Z, after `352bf15`. Outputs show `Qpoaam`, `br4F6F` and `JJUk57`, matching the docs copies. | The 18:48Z runs used `8fe2b81`. The docs copies come from the later final run. |
| Injected child failures are required negatives, not green tests | supported | `check-harness-failures.mjs` asserts the child exits with status 1 and the injected message matches. It then reopens the store, re-validates and requires owned removal. | |
| First run was 19/20; driver exited 1 before 30000ms; recovery uncertain, owned removal, no replay | supported | `validator-first-docker.txt`, `validator-watchdog-container.txt`, `validator-watchdog-recovery.txt`. Transcript 18:51:25Z journal dump shows `result: pending`. | |
| The driver's timeout cause is inferred; the exact exception was not recorded | supported | `validator-acceptance.md` and `validator-watchdog-review.md` both label it a source-supported explanation. | The worker brief at 18:53:36Z stated it as "Root cause is trigger…". The final record is worded correctly. |
| The new watchdog witness is honest | supported | Diff in `validator-watchdog-review.md` and the transcript: it inspects the exact recorded ID, rejects `exited`, and requires `running` before the original deadline. It then requires exact exit 124 and never resets the deadline. The delayed-start test keeps 30000ms. | Exit 124 plus the pre-deadline running witness rule out the watchdog's pre-start `exit(124)` path. |
| PNG integrity checked and image viewed | supported | Transcript 19:04:49Z asserts `checksum(png) === sample.png.sha256` and the size, after the image was viewed. I viewed `validator-final-A.png`: it shows the Run button and the letter A. | This proves the PNG decodes consistently from its own report. It is not independent provenance. |
| The empty resource listing is only a snapshot | supported | Transcript 19:04:27Z command filters containers by `name=eitri-frozen` and images by `reference=eitri-frozen-browser:*`. | It does not cover untagged images or build cache. The record's wording ("matching containers and derived image tags") is accurate. |
| The early 120s timeout is acknowledged | supported | `validator-acceptance.md` under "Inherited state", and the work log. | |
| Main lint, format and check pass with the new `docs/*.mjs` files | supported | Transcript 19:09:02Z: oxfmt reports all files formatted, and `npm run check` and `node --check` pass. | |

**Decisions trail (18:16:59Z to 19:07:39Z).** All 11 rows map to real actions, and their evidence resolves to what each row claims. Some timestamps lag the action by up to about 3 minutes, which is acceptable.

## 2. Contradicted claims

None.

## 3. Weak, unclear or unsupported claims

- **"They fail if their exact injection points change."** Unclear. This holds for `check-harness-failures.mjs`, which asserts a unique match, and `check-harness-finalizer.mjs`, which asserts the `indexOf` lookup. `check-harness-retention.mjs` uses an unasserted `.replace('    f.retainState();','')`, which does nothing on the final source. Its real guard is the `fs.rm` interceptor, so the check still works, but the sentence overstates.
- **Red-reproduction source revision.** Unclear. `validator-retention-red.txt` ran in `../eitri-screenshot-preparation/.audit/…` (fixture `cIPtXS`), and the artifact does not record that worktree's HEAD. The 18:28:53Z decisions row cites a different, earlier local run (`iL8686`, `.audit/validator-retention-before.txt`). The revision was plausibly `09dd337`, but I did not verify it.
- **Environment record timing.** `validator-environment.txt` was captured at 18:34:56Z against `09dd337`, not the final source. The final observation's provenance shows the same engine (29.4.0, arm64, daa0cb7f) and the same base image ID, so the substance holds. Only the capture time is off.

## 4. Material source-quality concerns

- **Some record artifacts cannot be rerun.**
  - The extraction for the stores and observation files, and the artifact check, were inline heredocs that are not checked in.
  - `validator-final-stores.json` `sourceRevision` is a hardcoded literal in that script, not derived from git.
  - `validator-final-resources.txt` contains only a timestamp. The file records neither the command nor its stderr. The transcript shows no Docker error, but the file cannot show that on its own.
- **A raw log was edited after the fact.** `validator-first-docker.txt` had trailing whitespace stripped at 19:10:29Z so that `git diff --check` would pass. The edit is whitespace only, and the original remains in `.audit`. The record does not mention it.
- **Diagnostic scripts hardcode the Docker context.** The scripts use `docker --context orbstack`, which ties them to this environment. They are parent verification artifacts and have no production behavior.

## 5. Missing evidence

- **Auxiliary-remover refusal and error branches were never executed.** The judge's minimum (`validator-design-review.md`) asked for:
  - wrong label, image or ID refusal
  - failed lookup, removal or confirmation
  - a lost create response that appears later
  - inspection failure during the cancellation drain

  Only a same-family static review covers these. The parent's real-Docker injections do cover both preflight findings directly. The green full suite also exercises idempotent cleanup, since `removeDependent()` runs inline and again through `f.defer(remove)`.
- **No decisions row for the `8fe2b81` unit.** That unit was the commit, the 311-test pass and the harness review PASS. Later rows mention it only indirectly. The show-me-your-work skill calls for an appended row here.

## 6. Material contradictions

None between sources. One wording drift: the worker delegation (transcript 18:53:36Z) stated the inferred driver cause as fact. The canonical record labels it correctly.

## 7. Implications for the original conclusion

The acceptance holds for the fixed synthetic validator contract at `352bf15`, unmerged and unwired. The parent chose real-Docker failure injections over the judge's mock matrix. That choice is sufficient for this claim on the merits, not just because the parent chose it: the injections hit both preflight findings on the real surface. It does not prove the harness remover's negative branches, which should be treated as statically reviewed only. The record keeps the negative history: the 19/20 run, the red reproduction, the 120s timeout and the inferred cause.

## Attention

Reviewed by Claude, launched as `anthropic/claude-opus-5-5`.

1. **The watchdog test is timing-coupled.** It relies on the 8000ms deadline firing before an unexplained driver exit, which was observed once at about 11.7s after admission. Admission was 1792435796746 (18:49:56.7Z) per the transcript journal dump, and the container finished at 18:50:08.48Z per `validator-watchdog-container.txt`. The new test has passed 3 times: the 8000ms prototype, `validator-watchdog-fixed.txt` and the final suite. A miss fails closed (exit 1, not 124), so it cannot falsely pass. A future flake would look like a watchdog regression.
2. **The remover's refusal and lost-create paths are unproven at runtime.** See section 5. A handoff should not describe "auxiliary cleanup refuses wrong containers" as runtime-verified.
3. **Fix record reproducibility before the local commit.**
   - Check in or describe the inline extraction and artifact-check scripts, including the hardcoded `sourceRevision`.
   - Record the command that produced `validator-final-resources.txt`.
   - Note the whitespace edit to `validator-first-docker.txt`.

   This brings the record up to the standard of the three rerunnable `check-harness-*.mjs` instruments.