# Profile-name fixture capture verification

## Accepted unit

Source commit `d7cbd4a8050b945bdd53622546ac3def71d63f9a` adds the guarded capture operation and its filesystem tests after `14160799960725ae4659f68f225cbba19b946467`. The [reference](../../fixture-profile-name.md) defines the public contract.

This is the next bounded fixture-integration prerequisite. The prior increment verified synthetic Docker handoff. Grounding found that the sibling demonstration repository has unborn `master`, preexisting untracked application files, and helper semantics inconsistent with the planned demonstration contract. The parent therefore selected honest single-file acquisition before changing trusted browser scenarios. No original baseline commit is invented.

The three new source/test files are the only executable changes. Existing source, controller dispatch, worker assets, containment, dependencies, Rust source, and sibling contents remain unchanged.

## Design and review

Two independent GPT sketches compared a direct capture operation with a serializable value and separate parser. Parent and fresh GPT cross-judge selected the direct operation. It transfers directly to the existing WorkspaceStore without a speculative receiving parser or base64 representation. Grafts add bigint/mode consistency, explicit integrity limits, actual short-read instrumentation, and managed-store reopen coverage.

One isolated writer owned the coupled capture and tests. Separate read-only artifacts held designs and reviews. Blocking grounding and design selection preceded implementation. No concurrent writers shared the implementation checkout.

Fresh `gpt-6.1-sol` correctness/security review finds no issues in the exact three-file snapshot. The reviewer performs static inspection only and attributes supplied hashes and runtime checks to the parent. A separate GPT comment audit requests zero deletions and retains the sole public API contract comment. Review independence is by fresh context within the configured GPT family, not different model families.

The complete [correctness review](correctness-review.md), [comment audit](comment-audit.md), [final evidence audit](evidence-audit.md), and [source identities](source-identity.txt) are retained alongside this record. The final evidence audit supports capture-only completion and finds no material contradiction. Parent recomputes the three identities after final execution. They match the reviewed and committed bytes.

## Parent checks

Run from the integrated main checkout with Node 26.5.0:

```sh
node --test test/fixture-profile-name.test.ts
npm run verify:all
```

The focused command passes all 12 tests. Final `verify:all` passes all 1,231 Node tests and 30 Rust tests. Lint, formatting, type and syntax checks pass. There are no failures, cancellations, skips, or ignored Rust tests. Existing future-incompatibility warnings remain for Rust dependencies `block` and `proc-macro-error2`.

Tests cover literal capture shape and a pinned independently specified digest, raw byte preservation, size limits, detached buffers, host-independent identity, symlink routes, linked/nonregular leaves, bounded allowlisted reads, deterministic mutation and I/O failures, actual short reads, descriptor closure, and real WorkspaceStore transfer/read/reopen. Test-only subprocess interposition asserts that its hooks ran. Normal `npm test` includes all new cases and excludes the helper executable from discovery.

Parent also invokes the library against the actual sibling helper, without importing or executing that helper. It captures 525 bytes with source SHA-256 `5fa6710bb0c4f120408d489d0b16f6a21bfc6e539081ab1d9fda7a3bddb1fa07` and capture digest `4a0ca6e84af5aa34eb429049c177762746b9acc0c6c0f35d75503900e51c2312`. Source checksum matches the preimplementation observation. File identity, mode, size, modification time, change time, and Git status remain unchanged. Only metadata and hashes are retained in the [capture observation](actual-capture.json), not source bytes. `.env` and `dist` contents are not read.

Raw parent logs remain local in `.audit/fixture-next-parent-focused.txt` and `.audit/fixture-next-parent-verify-all.txt`. The final full command exits zero. The parent also confirms that protected tracked file hashes remain unchanged.

## Retained incomplete and failed checks

The writer's 12 focused tests and static checks pass. Its ordinary `npm test` invocation executes the 12 new cases successfully but reaches its 240-second timeout during existing tests. That invocation is not a full-suite pass. The later parent full run completes independently.

The initial parent baseline full run passes all 1,219 existing Node tests, then fails one Rust test at process spawn with ENOENT. Inspection of the cached test binary finds an embedded `CARGO_MANIFEST_DIR` for the previously removed `eitri-native-consumed-check` worktree. Touching the local crate source without changing its bytes forces recompilation. All 30 Rust tests then pass. Final parent `verify:all` also passes. No Rust source-content change is part of this increment. Baseline failure and rebuild logs remain in `.audit/fixture-next-baseline-verify-all.txt` and `.audit/fixture-next-baseline-operator-rebuild.txt`.

## Limits and next boundary

Capture requires a quiescent, operator-controlled directory. It does not contain hostile same-UID races or authenticate source provenance. Returned buffers remain mutable. The allowlisted helper could itself contain sensitive data.

The `profile-name-v1` metadata does not activate a worker scenario. No browser or Docker execution is performed for this capture-only unit. The next unit is a protected profile-name probe against captured bytes and a managed candidate. React application validation, protected baseline-test reconciliation, other demonstration scenarios, M2 acceptance, production activation, and later human-presence gates remain open.

No sibling edit, secret access, live service, application inference, dependency change, policy widening, global configuration change, remote publication, or deployment occurs. No remote is configured, so PR creation is skipped.
