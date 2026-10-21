# Native consumed-check verification

## Accepted scope

Source commit `b248c008328bf9b88170a9177958fc57821830ab` implements the next offline prerequisite after `93c0c97`. The [reference](../../native-browser-check.md) describes the library-only native receipt boundary. The eight-file [identity manifest](source-identity.txt) matches the reviewed, committed, full-verified, and integrated source and tests.

The native operation accepts unknown settled claims and obtains independent authority from its optional controller host. Real baseline and browser receipts have compact public provenance and a private bounded complete execution envelope. Scripted callbacks remain simulated-only. Current action, source, revision, binding, allowance, and cancellation checks guard persistence. Existing multi-store crash windows remain.

## Design and principles

Two independent GPT sketches converge on native-owned conversion and controller-owned authority. They differ in stored representation. The parent and fresh cross-judge select the private full-report design instead of a new screenshot-reconstruction codec. The [synthesis](design.md) records the first-baseline correction, optional capability compatibility, duplicate-publication policy, and rejected atomic-publication addition.

Model the Domain selects discriminated real and simulated receipts. Boundary Discipline puts unknown-report and persisted-envelope validation at their entry points. Laziness Protocol reuses the converter and one private publisher. Sequence Work into Verifiable Units puts focused checks before integration. Test Behavior, Not Implementation requires literal receipt and PNG assertions. Prove It Works requires actual native files, parent execution, and unchanged source identities. The parent reads each named principle's leaf skill during this session.

## Parent verification

The implementation worktree is `/Users/felix.langbein/projects/eitri-native-consumed-check`. The parent executes the following full command there after writer completion.

```sh
CARGO_TARGET_DIR=/Users/felix.langbein/projects/eitri/operator/target npm run verify:all
```

It passes TypeScript lint, formatting, type and syntax checks, all **1,180 Node tests**, Rust Clippy, Rust formatting, and all **30 Rust tests**. There are no test failures, cancellations, skips, or ignored Rust tests. The Rust target directory reuses the existing dependency build cache. Existing future-incompatibility warnings for `block` and `proc-macro-error2` remain.

The retained log `.audit/native-admission-parent-verify-all.txt` starts with the exact implementation cwd. Its SHA-256 is `613900a8c074610c9c8cf3b8209051fa31c21e4e4199057d0f4e2b4898cc44d1`.

After local fast-forward integration onto main, the parent executes the following checks again.

```sh
npm run check
node --test test/native-consumed-check.test.ts test/native-consumed-check-authority.test.ts
shasum -a 256 -c docs/evidence/native-consumed-check/source-identity.txt
```

Type and syntax checks pass. All **81 new tests** pass with no failures, cancellations, or skips. All eight source identities match. The retained log `.audit/native-admission-parent-integrated.txt` has SHA-256 `2a48846e9dca9edcfd8c5fd153e6b3509c352a55555cf7f6724ffd654bcd7e48`.

An earlier parent full command accidentally runs in main before integration. That run passes the unchanged baseline, not this implementation. It is retained separately as `.audit/native-admission-parent-baseline-verify-all.txt` and is not counted as implementation verification.

## Writer and independent review

The writer reports 143 passing targeted tests and a final two-test authority rerun. The parent reads the retained logs in the implementation worktree. Earlier unit-one typing errors are retained in `.audit/native-consumed-check-unit1.txt`; later type, lint, formatting, targeted, and parent full checks pass. The writer performs no full verification run, preventing overlap with the parent run.

The fresh GPT [correctness review](source-review.md) passes without findings. A prior reviewer times out during a broad home-directory file search before supplying a verdict. A fresh replacement reviews the same frozen bytes using exact paths and the supplied identity manifest. No implementation changes follow either review.

The separate GPT [comment review](comment-review.md) finds no new comments or suppressions and requires zero deletions. All delegated roles use `openai-codex/gpt-6.1-sol`. Independence is by fresh context, not model family. Reviewers provide source analysis; parent commands supply independent execution evidence.

## Evidence limits

Tests use scripted worker claims with literal PNG bytes and actual temporary native SQLite files. They exercise all four behavioral outcomes, blocked and malformed reports, retained-controller authority, interruption gates, duplicate mixed publication, reopen mutations, 32 MiB aggregate durability, and existing publication fault windows. The native document can store the 8 MiB plus 512 KiB envelope ceiling, but a deliberately padded report at that ceiling still rejects under the converter's separate evidence limit. Existing actual SIGKILL tests preserve conservative legacy ordering.

These results do not establish actual Docker execution, containment, cleanup, daemon quiescence, or hostile same-UID authorship. Real-check flags do not turn a faux-model case into a genuine model fix. Filesystem, native receipt, worker journal, and controller catalogue effects are not one atomic transaction.

Production `run_check`, main and HTTP dispatch remain unwired to this operation. No worker assets, table/schema versions, dependencies, Rust source, containment policy, monitored fixture, secrets, live services, application inference, remote publication, or deployment change. Report handoff into the trusted driver, actual fixture validation, M2 acceptance, and later human-presence gates remain open.
