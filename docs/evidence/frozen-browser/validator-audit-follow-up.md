# Validator acceptance follow-up audit

**Verdict: PASS, with two non-blocking notes.** The post-audit fixes close the record-production gaps that the earlier audit flagged. I found no tool bug and no false claim in `validator-acceptance.md`. One point does not match the parent brief. The brief says the report now records the pinned `orbstack` context, but `validator-acceptance.md` and `docs/work-log.md` never mention it.

**Scope and method.** This review covers only the post-audit delta. It is read-only. I ran no Docker, tests, edits, subagents or external access, and I did not recompute any hashes. I read the poteto-mode SKILL.md, but none of its leaf principle skills, so I cite no principles. I read these files directly:

- `validator-acceptance.md` (current)
- `record-validator-acceptance.mjs` and `check-harness-retention.mjs`
- the regenerated artifact check, resource listing, environment record, and red and green retention logs
- the three `*-before-audit.txt` snapshots
- the observation JSON and the header of the stores JSON
- `decisions.tsv` and the tail of `docs/work-log.md`
- parent transcript lines 310 to 324 (19:19:57Z to 19:23:12Z)

## 1. Verified claims

| Claim | Status | Evidence and reasoning |
|---|---|---|
| The producer resolves an explicitly supplied tested ref through Git | supported, high | It asserts that `argv[4]` exists, then runs `git rev-parse --verify <ref>^{commit}`. The store's `sourceRevision` now comes from that resolved value, not a literal. |
| The executable-source paths match between `352bf15` and the current checkout, and the tree is clean | supported, high | It runs `git diff --exit-code <ref> HEAD` and `git diff --exit-code HEAD` over src, worker, test, prototypes, package.json, package-lock.json and tsconfig.json. `execFileSync` throws on exit 1. This path set matches `validator-source-identity.txt`, whose full diffstat shows only `docs/frozen-browser.md` changed. |
| SQLite is read without writes | supported | `DatabaseSync(..., { readOnly: true })` and `PRAGMA trusted_schema=OFF`. |
| It checks 13 fixtures, 39 settled runs, exactly one unknown build with incomplete cleanup, and the PNG hash | supported, high | These are literal assertions in the producer. It asserts the PNG with `validateOutput` and with `checksum(png) === sample.png.sha256` plus the size. All assertions and Docker calls run before any `writeFile`, so a failed check writes nothing. |
| It captures each command, exit status, signal, stdout and stderr, and requires a successful exit | supported | The `docker()` helper does this. `validator-final-resources.txt` and `validator-environment.txt` show the exact argv, `exit=0`, and stderr `<empty>`. |
| The current engine and base match the stored observation | supported | The producer asserts Version, Arch and GitCommit against `provenance.engine`, and the base `Id` against `baseBefore.id`. The recorded values (29.4.0, arm64, daa0cb7f, sha256:57911b2d…) match the observation JSON. |
| The record does not claim that the log is bound to its revision | supported | `validator-acceptance.md` says the transcript remains the evidence for which revision produced the original log. |
| The parent ran the producer twice, and the stores and observation JSON did not change | supported, high | Transcript 19:19:57Z and 19:22:04Z show the producer passing twice. `git diff --numstat` was empty at 19:20:17Z and `git diff` was empty at 19:22:11Z. The 19:23:12Z `git show :path` commands show these files are staged, so the empty diff is a real comparison against the pre-audit versions and is not empty by default. |
| The PNG digest did not change | supported | `shasum` returned `40de898e…`, which equals `png.sha256` in the unchanged observation JSON. The producer also asserts this equality. |
| `validator-artifact-check.txt` matches the final producer wording | supported | The message edit at 19:20:03Z added a trailing space. `oxfmt --write` ran before the second run, and the file text matches the second run's output. |
| The retention tool prints HEAD and checks the source diff | supported | It runs `rev-parse HEAD`, then `git diff --exit-code HEAD -- src test worker` before printing the header. A printed header therefore means the diff check passed. |
| Red was regenerated at `09dd337` and green at `88f8909` | supported | The red header names `09dd337…` in `../eitri-screenshot-preparation`, fixture `SIjYIW`, with the expected exit 1 (transcript 19:20:18Z). The green header names `88f8909…` in `../eitri-validator-acceptance`. `88f8909` contains the tested source per the source identity check. The failure line moved from 67 to 79, which is consistent with the added header code. |
| The pre-audit snapshots are preserved | supported | Transcript 19:23:12Z extracts them with `git show :path` from the index, which still held the pre-regeneration versions. Their contents match the original audit's description: a timestamp-only resource file, the 18:34:56 environment record, and the `cIPtXS` red run. |
| The `8fe2b81` decisions row was appended without backdating | supported | The row timestamp is 2026-10-19T19:23:12Z, and its text reads "Retrospective checkpoint, not a backdated action". |
| The extracted-source guard claim is now qualified | supported | The record now says the failure-injection and finalizer tools assert their extraction points, while the retention tool rejects root removal. It also says the `retainState` removal is only compatibility with the old source. This matches the code, where the `.replace` is unasserted and the `fs.rm` interceptor is the real guard. |
| Timing coupling and the statically reviewed refusal and lost-create branches are stated as limits | supported | The "Audit limits" section states both. It says a timing miss fails rather than passes, and it makes no runtime claim about the remover's negative branches. |
| The hardcoded old source field is disclosed | supported | The "Record reproduction" section states that the original inline producer hardcoded it. |

## 2. Contradicted claims

None in the record itself. The parent brief's statement that the report now records the pinned `orbstack` context is not borne out. See section 3.

## 3. Weak, unclear or unsupported claims

1. **The pinned Docker context is not disclosed (unclear, low severity).** The producer and the existing diagnostics hardcode `docker --context orbstack`, and the producer also hardcodes the base tag `eitri-chromium-probe:1.64.1-node26.5.0`.
   - Neither `validator-acceptance.md` nor `docs/work-log.md` mentions this. The context appears only inside the generated artifacts.
   - The "Runnable checks" and "Record reproduction" sections present the commands as rerunnable with no environment qualifier.
   - The record should say in one sentence that these tools target the local `orbstack` context and the fixed base tag. The final handoff should not claim this was already logged.
2. **Rerunning the producer is time-bounded and changes evidence (unclear, low severity).** The tool reads fixture roots retained under the macOS per-user temp directory (`/private/var/folders/.../T`).
   - The OS may purge that directory, so a later rerun can fail. If it fails, it fails before writing anything.
   - A successful rerun overwrites the committed `validator-environment.txt` and `validator-final-resources.txt` with new capture times.
   - The current resource snapshot (19:22:04Z) was taken about 19 minutes after the final suite, and after the red and green retention reruns, which ran real Docker work. The record's wording "at its recorded time" is accurate. Neither the record nor the work log says this snapshot follows those reruns rather than directly following the suite, or that a rerun refreshes it.
3. **The "two blank lines" whitespace claim was not independently diffed (unclear, low risk).** `validator-first-docker.txt` and `.audit/validator-acceptance-docker.txt` both have 67 lines. The earlier audit had already confirmed the edit was whitespace-only from the transcript. I could not see the trailing whitespace with my tools, so the count of two is not verified.

## 4. Material source-quality concerns

- **The identity check is scoped to seven paths.** The success message "differs only outside executable source" means outside that path list. It ignores untracked files and any top-level directory not in the list. For this revision pair it is accurate, because the full diffstat shows only a docs change. This is not a tool bug.
- **The red log does not show the retained contents.** The record's red-retention prose says the original accounting remains retained after the attempted deletion. The red log fails at the status assertion before the tool reads any records, so it only shows that deletion was rejected. This wording predates this delta, but the linked artifact changed from `cIPtXS` to `SIjYIW`. It is non-blocking and inference-level.
- **`.audit/` is local-only scratch.** The original first-failure log and `validator-harness-node.txt`, which the new decisions row cites, live there. The record names the path in plain code rather than as a committed link, which is acceptable.

## 5. Missing evidence

- I did not diff `validator-first-docker.txt` against the original byte for byte.
- No artifact shows that `SIjYIW` retained its records after the red run.
- No other material claim in the delta is missing evidence.

## 6. Material contradictions

One mismatch between the brief and the record. The brief lists the "pinned orbstack context" among the qualifications the report now contains. Neither the report nor the work log contains it. There are no contradictions between sources.

## 7. Implications for the original conclusion

The acceptance of the unwired validator at `352bf15` still stands, and the delta strengthens it.

- The store revision is now derived from Git instead of a literal.
- The environment and resource snapshots now carry their commands, exit status, stderr and both revisions, and are checked against stored provenance.
- The red and green retention logs now name their target revisions.
- The record's claims are worded at the correct certainty.

Before the local commit, I recommend two one-sentence additions to `validator-acceptance.md`, neither blocking:

1. The producer and diagnostics target the `orbstack` context and the fixed base tag.
2. A rerun works only while the retained temp-dir fixtures still exist, and it refreshes the environment and resource snapshots. The current resource snapshot follows the retention reruns, not the suite directly.

If the final handoff mentions the pinned context, it should cite the record once those sentences are added.