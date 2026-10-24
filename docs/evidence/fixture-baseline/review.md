# Review: installed fixture baseline

Five-axis `/skill:review`, performed directly by the implementing assistant. This is not independent-agent, second-model, or cross-family assurance. Scope: the root verifier, pinned installed descriptors, portable materialization tests, documentation, and the sibling's 30-file initial checkpoint.

## Findings and applied feedback

| Severity | Location | Finding | Resolution |
|---|---|---|---|
| Important | `../eitri-test-web-app/.gitignore:5` | The original ignore list omitted `.env`; a broad initial staging command could include the existing secret-bearing file. | Ignore `.env` and `.env.*`. Stage only the 30 explicit baseline paths, assert the complete index set, and verify `.env` is ignored and absent from the index. Its contents are never acquired. |
| Important | `test/profile-reconciliation-materialization.test.mjs:215` | Synthetic acquisition tests supplied their own descriptors, so they did not detect drift in the real installed manifest. | Pin all 28 descriptors to the committed prior scenario observations; additionally compare overlay and generated metadata identities with current trusted assets. |
| Important | `test/profile-reconciliation-materialization.test.mjs:257` | The first tampering test changed size, leaving same-size checksum substitution untested. | Add same-size replacement and hardlink controls alongside size, missing-file and symlink controls. All reject before Docker calls. Unknown CLI modes also reject before source acquisition. |
| Important | `docs/fixture-profile-name.md:145` | Managed-probe instructions still described the engine conflict closed by the preceding commit. | Link the actual compatibility checkpoint and document modern fresh journals versus unchanged legacy identities. |

## Final five-axis assessment

- **Correctness:** installed acquisition uses actual allowlisted bytes, not replacement overlays, and applies neither patch. Original pre-reconciliation mode stays available. Actual contained runs preserve normal checks and demonstrate separate target-red/candidate-green outcomes without installing a fix. Candidate-only regressions are not added to the baseline. README, existing environment file and the 14 non-overlaid original inputs are preserved.
- **Readability:** one explicit optional flag and one pinned descriptor file; no installer framework, package, configuration layer or new public controller API. Reports identify the selected input layout.
- **Architecture:** both layouts join the existing five-variant runtime and exact result-admission logic. Expected outcomes stay controller-owned. This is an offline snapshot recipe, not immutable full-application controller integration or production activation.
- **Security:** acquisition retains canonical/quiescent-root, regular-file, single-link, size/hash and symlink guards. Only declared inputs enter Docker; no original `.env`, `dist`, dependency directory or Git metadata is acquired. Reporting is opt-in and validation remains offline. Docker policy, exact engine pin, non-root execution, mounts, resource ceilings and owned cleanup are unchanged. Same-UID race containment is not claimed. The existing lockfile is unchanged, not a new dependency upgrade or release audit.
- **Performance:** acquisition is fixed at 28 small reviewed files; the largest is the existing 74,142-byte lockfile. No new hot path, service, cache or network operation is introduced. Existing bounded builds and browser observations are reused; no performance improvement is claimed.

**Verdict:** no unresolved Critical or Important findings. Runtime and suite results are recorded in [verification](verification.md). No hosted publication or full M2 acceptance is approved by this review.
