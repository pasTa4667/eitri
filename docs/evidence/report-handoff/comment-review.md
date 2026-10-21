# Scoped comment review

Recommend deleting all three added comments. No repository files were edited.

## Deletions and exact MUST KILL targets

- `src/controller.ts:1789`. Delete `// Drain outside the workspace queue because journal opening also needs it.` MUST KILL `Controller.dispatchCheck`’s `consumed-browser` branch. Name or extract the drain-before-acquisition boundary. Both queue operations are repository-owned orchestration, not an external constraint.
- `src/controller.ts:2351`. Delete `// Register cleanup before handoff waiters without replacing the rejecting close promise.` MUST KILL `Controller.revokeWorkerScope`. Name the original close promise and registry-cleanup responsibilities explicitly. The adjacent implementation already expresses registration and return ordering.
- `src/native.ts:658`. Delete `// Completion tokens belong to the admitted action object, not its provenance snapshot.` MUST KILL `NativeCase.recordConsumedBrowserCheck`’s publication closure. Distinguish admitted action identity from the cloned provenance anchor through naming or types. The completion map is an internal identity constraint.

Preserve the underlying behavior. These flags recommend reshaping internal explanations, not removing drainage, rejection propagation, cleanup ordering, or action identity.

## Exceptions and skips

No justified exceptions. No added or changed suppression directives were found.

The other four scoped files contain no added comment targets. Existing unchanged comments are excluded.

Recommended deletions total three comment lines. MUST KILL flags total three. Files touched, restorations, implementations, and encodings total zero.

## Evidence and limitations

Read poteto-mode completely, including Principles, the Comment Sicko instructions, selected design, and complete supplied diff. Inspected nearby implementation for each comment.

**Minimize Reader Load** shaped the recommendations. Its leaf skill was read completely. It changed the recommendation toward explicit boundary names and action-identity types rather than internal explanatory prose.

Manifest verification passed for all six scoped files and the diff. Scoped `git diff --check` passed. No staged files were reported.

No runtime tests or live integrations were executed. Prior verification logs are not this review’s execution evidence.

The requested artifact write was blocked because its destination is outside the working directory. This response contains the report for runtime persistence.