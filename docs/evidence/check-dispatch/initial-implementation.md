Implemented the admitted-check boundary in commit `2646b909185a1cbb705dbb50f4d043884a2c23a6` on `implement/check-dispatch`.

Changed files are listed below. Production edits stay within the three approved files. The supervisor approved the additional embedded callback migration in `operator/src/artifact_tests.rs`. `test/recovery.test.ts` needed no textual migration.

Validation passed 82 focused tests, all 367 Node tests, and all 30 Rust tests after the fixture migration. The full `verify:all` invocation exposed that legacy fixture. Per supervisor direction, its unchanged long Node portion was not repeated afterward.

Principles applied:
- Model the Domain and Type System Discipline selected exclusive execution variants.
- Boundary Discipline placed unknown-return parsing and copying in Controller.
- Laziness Protocol kept the scalar request without compatibility overloads.
- Test Behavior, Not Implementation used public Controller operations.
- Prove It Works required persisted-action correlation and genuine SIGKILL tests.

Open limits remain non-atomic artifact persistence, snapshot-only allowance and no worker cleanup-drainage guarantee. The browser validator remains unwired.

Recommended next step is independent review and the parent's integrated `verify:all` run.

The direct artifact write was blocked by the output-path guard. This response supplies the findings for runtime persistence.