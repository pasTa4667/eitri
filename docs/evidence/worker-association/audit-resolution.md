# Evidence audit resolution

The cross-family evidence audit passes with six nonblocking corrections. Its original report is preserved unchanged in [evidence-audit.md](evidence-audit.md). This resolution changes documentation only. Executable and test source remain `183bf56578758983b10a193a9e380fb7dce66f66`.

## Corrections

1. `source-identity.txt` now includes the exact source-diff command, tested HEAD and exit code 0. The verification record distinguishes this later labeled check from the original before/after checks. Those original checks remain in the active transcript, independently confirmed in the audit. They were not redirected into the full-suite log.
2. The verification record now says both reviewers knew the green test counts. The specification reviewer explicitly excluded them as correctness proof. The standards reviewer also inspected the log. No blinded review is claimed.
3. The design, verification record and work log now identify fresh-context reviews on `openai-codex/gpt-6.1-sol`. Only the evidence audit uses `anthropic/claude-opus-5-5`. No cross-family source review is claimed.
4. Both initial source-review prompts paraphrased the commit subject incorrectly. Supervisor replies supplied the actual subject, `feat(controller): retain offline worker intent and inspect owned history`, together with the exact SHA and generated diff. The scope remained correct. This note records the prompt error without rewriting either review.
5. An append-only decision row clarifies that the design row was retrospective. The decision preceded implementation at roughly 11:10Z; its log entry was written at 11:37Z. The durable design pointer is [design.md](design.md), which now also carries the model-provenance correction. The verification record links all three source-review reports, including [comments-review.md](comments-review.md). Local plan pointers remain local scratch, not committed acceptance evidence.
6. The parent separately reviews the one-line cross-link update in `docs/worker-recovery.md`. Its target `docs/worker-association.md` exists and documents the implemented historical association. This documentation update is outside the independently reviewed source diff. The work log and append-only decision row now record that distinction.

## Verification limits

No complete baseline suite ran during this continuation. The 200-second baseline was interrupted. The completed candidate suite is a passing candidate result, not a measured no-regression comparison against a completed baseline.

Runtime evidence is offline and synthetic. Seeded journals, the fake Docker binary and the validator trap exercise the association contract without worker execution. Inspection can write journal uncertainty recovery before identity comparison. Neither this audit nor the source reviews prove a live execution handoff, present daemon cleanup or M2 acceptance.

The parent inspected the focused suite's literal snapshot and journal comparisons. The accepted-inspections test seeds a pending run, requires matched history and verifies the sole pending-to-recorded uncertainty transition while preserving metadata and original intent. The fixture teardown checks zero validator calls and absence of the Docker sentinel file. These assertions passed in both the focused parent run and the full parent suite. The cross-family auditor did not independently rerun them.

All final evidence-only edits receive parent review and `git diff --check`. The first staged evidence check flagged one blank line at the end of `parent-verify-all.txt`. The documentation commit was created despite that warning, then amended locally after removing that single blank line. The audit's byte-identical-copy statement describes the pre-normalization artifact. The original raw log remains `.audit/association-parent-verify-all.txt`; all test output is unchanged. The full runtime suite is not rerun for prose and copied-log changes. No source or test byte changes after the passing suite.
