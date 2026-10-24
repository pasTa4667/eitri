# Five-axis review: full-application input capture

Scope: the next bounded M2 acquisition/frozen-transfer slice, starting at `82f5cda`. This is an author self-review using `/skill:review`, not independent or cross-family assurance.

## Findings and resolution

**Important — mutable imported inventory could change acquisition paths.** The first implementation rebuilt its selection from the shared JSON object on every call. An importing colleague mutating the first path to `.env` caused the capture to include `.env` instead of the reviewed application path. The focused regression fails on that implementation (`.audit/application-input-review-red.txt`). `src/fixture-profile-name.ts:25` now copies, validates and freezes the path list at module initialization. The regression in `test/fixture-application.test.ts` requires the original selection after inventory mutation. No caller-controlled path selector is exposed. This protects later accidental mutation, not hostile code running before initialization in the same trusted Node process.

No Critical findings or outstanding Important findings remain.

## Five axes

- **Correctness:** Exact ordered raw descriptors and canonical digest; all 28 inputs affect identity. Each selected leaf rejects missing, linked, nonregular and oversized input. Cross-file changes reject the whole capture; all acquired descriptors receive closure attempts. Existing helper and reconciliation output contracts/digests remain covered. The new managed-store test verifies complete baseline and candidate reads after changing the source checkout and returned Buffers.
- **Readability:** One new fixed capture operation reuses the existing private acquisition engine. Shared output types retain the reconciliation tuple's literal path types. No new provider or execution mode.
- **Architecture:** The installed manifest supplies only the application's fixed acquisition paths, not authority or a validation verdict. Existing WorkspaceStore owns Git checkpoint/freeze semantics. No controller, worker, native or production activation change. An importing caller must still enforce protected manifests/configuration before execution.
- **Security:** Bounded, canonical, no-follow/nonblocking reads; all route components and leaves are checked and rechecked. No directory enumeration, package/configuration execution, credential loading or raw native error disclosure. Excluded paths stay excluded. Same-UID races and sensitive content inside allowed files remain documented limits.
- **Performance:** At most 28 held descriptors and 28 MiB payload under current limits. Directory preflight deduplicates common ancestors. Rechecks remain bounded by the fixed path set and root-length limit; no new background or network work.

## Verification

- Initial RED: missing new API export, recorded in `.audit/application-input-red.txt`.
- First integration test used the wrong `readFrozen` signature and failed with `signal.addEventListener is not a function`; the test now calls the existing whole-revision API with an AbortSignal, without changing production workspace behavior.
- Focused capture suites passed before the review regression was added; final full verification is recorded in the work log.
- Actual sibling capture and managed freeze pass with 28 exact installed descriptors; observations are retained locally in `.audit/application-input-managed/observations.json`. No fixture code is executed and no original file is written.
- An initial full verification attempt hit its 300-second harness timeout while progressing through existing long-running tests. It is not counted as a pass. The subsequent full run uses a retained completion-status file.

Final `npm run verify:all` exits 0 with 1,810 Node tests and 30 Rust tests passing, no failures/cancellations/skips, and all lint, formatting and compilation checks passing (`.audit/application-input-verify-all-final.txt` and `.exit`).

Verdict: approve this bounded slice after the addressed finding and final verification; no outstanding source changes requested by this self-review. Full-application execution through the controller remains outside this slice.
