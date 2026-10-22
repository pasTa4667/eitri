# Fresh GPT correctness/security review

**PASS for the bounded static review.** Runtime verification remains pending.

## Scope and reviewed hashes

Reviewed the supplied patch for `d7cbd4a8050b945bdd53622546ac3def71d63f9a` after `14160799960725ae4659f68f225cbba19b946467`, the selected contract, and all three changed files in full.

Exact SHA-256 identifiers recorded in `.audit/fixture-next-review-hashes.txt`:

```text
5ae3b6a4169b3c52208c8fe405fdd22082265bf9beab381511a5b476076b0bac  src/fixture-profile-name.ts
01190e604795c243f36da492f01d1a354d0dca3f22d7a9558bf8b32e24404ecf  test/fixture-profile-name.test.ts
28b17bee901847db581c76c998c928975ea7d984639d762f40d2c12214e6ffe7  test/fixture-profile-name-worker.ts
```

These hashes came from the supplied manifest. I did not independently recompute them. The current files matched the supplied patch by inspection. `watchdog_diff` reported no working-tree changes against reviewer-launch HEAD `d7cbd4a8050b`. It does not verify committed ranges.

## Review

- Correct. The acquisition uses the fixed source path, canonical absolute selection, ancestor directory checks, single-link regular-file checks, and guarded open flags. See `src/fixture-profile-name.ts:23`, `:43-87`.
- Correct. Allocation follows the size check. Positional reads handle short reads, reject premature EOF, and probe one extra byte for growth. Bigint descriptor, leaf, and directory checks precede acceptance. The descriptor closes in `finally`. See `src/fixture-profile-name.ts:72-106`.
- Correct. Filesystem errors become path-free codes. The returned descriptor contains no host path, timestamps, original revision, or scenario-validity assertion. See `src/fixture-profile-name.ts:108-126`.
- Correct. `captureDigest` hashes the descriptor once. `domain.digest` performs the hash, while `workspace.sha256` validates and brands its result. See `src/fixture-profile-name.ts:108-117`, `src/domain.ts:222-232`, and `src/workspace.ts:26-31`.
- Correct. Tests assert a literal capture shape and pinned digest with an independently specified canonical string. They also cover raw bytes, bounds, detachment, host independence, and unsafe filesystem inputs. See `test/fixture-profile-name.test.ts:55-180`.
- Correct. Child instrumentation patches filesystem calls before importing the capture module. Assertions require actual hook execution, expected positional reads, and descriptor closure. See `test/fixture-profile-name-worker.ts:40-107` and `test/fixture-profile-name.test.ts:208-279`.
- Correct. The interoperability test provisions, reads, closes, reopens, and rereads a real `WorkspaceStore`. The default test glob includes this test file but excludes its worker helper. See `test/fixture-profile-name.test.ts:281-302` and `package.json:11`.
- Fixed. None. No files were edited.

No issues found.

- Merge verdict. **OK with notes.** No correctness/security finding blocks this bounded change. This verdict does not replace the parent's pending runtime verification.

## Actual checks

Completed through read-only tools:

- Read the review brief, selected contract, hash manifest, complete patch, and changed files.
- Inspected the relevant digest, checksum, branding, limits, provisioning, read, and close implementations.
- Checked test entry-point inclusion and TypeScript configuration.
- Checked working-tree state with `watchdog_diff`.

No test, type-check, or hash commands were executed. This reviewer had no execution tool and was instructed not to use shell commands.

Parent verification still needs to establish results for:

```text
node --test test/fixture-profile-name.test.ts
node node_modules/typescript/bin/tsc --noEmit
shasum -a 256 src/fixture-profile-name.ts test/fixture-profile-name.test.ts test/fixture-profile-name-worker.ts
```

## Residual limitations

The review assumes an operator-controlled, quiescent source directory. Hostile same-UID race containment is not promised. Returned buffers remain mutable, and checksums do not authenticate provenance.

The brief reports that the writer's full-suite run timed out after the new tests passed. I did not independently verify that result. Full-suite completion and actual helper capture remain parent-owned. No Docker, real fixture-source reads, secrets, package operations, project mutations, or subagents were used.

## Review method

Read the poteto-mode skill in full, including its Principles section. **Prove It Works** shaped the reporting decision to distinguish inspected assertions and supplied hashes from reviewer-executed verification.

Throughput checkpoint is n/a for this read-only investigation.