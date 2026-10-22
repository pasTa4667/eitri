## Review

Scope: parent-supplied diff since `ca981f6`, including both untracked files. Found **2 added comments**.

- **Correct / keep:** `worker/frozen-browser/driver.mjs:281`. "Language operations avoid candidate-replaced intrinsics and never inspect a thrown value." External JavaScript-platform constraint: candidate code can replace intrinsics and throw accessor-bearing objects. The live invocation uses direct language operations and an unbound `catch` (`:284-296`), reached at `:435`. Adversarial cases exist in `test/integration/profile-name-probe.test.ts:327-349`; not executed during this audit.
- **Finding: P2 / delete:** `worker/frozen-browser/driver.mjs:243`. "Only the reviewed helper may expose native exception properties to the protocol." Narrates our own guard and policy. The manifest comparison (`:234-239`), conditional (`:244`), and property reads (`:264-270`) already encode it. Delete without replacement.
- **MUST KILL:** `worker/frozen-browser/driver.mjs:234`, `probeProfile`’s `pinned`. rename to expose that it matches the reviewed helper’s path, size, and digest, rather than relying on prose.
- **Merge verdict:** OK with notes.

### Files and counts

- Files modified by reviewer: **none**.
- Proposed comment-only deletion: `worker/frozen-browser/driver.mjs`.
- Deletion count: **1 comment / 1 line**; applied: **0**.
- Skips: the platform-constraint comment above; untouched comments outside the diff; other five scoped files contain no added/changed comments.
- No tests, Docker, shell commands, or application-code edits performed.

### Source hashes

Parent-computed SHA-256 values from `/Users/felix.langbein/projects/eitri/.audit/profile-probe-review-hashes.txt`; not independently computed by reviewer. Compare before applying recommendations.

| Scoped file | SHA-256 |
|---|---|
| `src/frozen-browser.ts` | `894f8348ea62a4952900a30e37c886b60afa379736e30e171272ed6a490f71cc` |
| `src/profile-name-definition.ts` | `2bf47122851dea6c4bd8ae4968c3a2d5ea976f3f4fc28bc6687888efc871dd25` |
| `test/frozen-browser-admission.test.ts` | `29557f0b28b365abd80e8a80261f1dbea37039c644bff3afc5386dc6336196d5` |
| `test/frozen-browser.test.ts` | `9bdf8317b28aa2ba1c23b33dab93583e7578f2b88999b680a766c45b7d4659a1` |
| `test/integration/profile-name-probe.test.ts` | `5dd61256e62c24ca608a41859ebac126db65346a5da83557c1846a074a5c7302` |
| `worker/frozen-browser/driver.mjs` | `6c0d1922e532d2f4eaded76d3a52609431d136dbc74d18480babce797889201a` |