# Selected native consumed-check design

## Synthesis

Implement candidate A, revised by the complete fresh GPT cross-judge. The parent reads both full candidates and the full judge. Both candidates converge on native-owned raw-report conversion and controller-owned fresh authority. Their persistence designs differ. A retains the full private report. B strips screenshot bytes and exposes report data publicly. A wins on smaller parser obligations and a compact public DTO. No new codec is introduced.

The judge is /Users/felix.langbein/.pi/agent/sessions/--Users-felix.langbein-projects-eitri--/subagent-artifacts/outputs/edd33446-f457-4ba0-8fb0-d3a35511bd0d/.audit/native-admission-design-judge.md. Its selected contract, data shapes, bounds, authority and tests are the implementation contract. The original candidate is /Users/felix.langbein/.pi/agent/sessions/--Users-felix.langbein-projects-eitri--/subagent-artifacts/outputs/93900fbe-5fcb-4c76-ac4f-b5c2100c7e60/.audit/native-design-a.md.

B contributes explicit same-action duplicate rejection, anchor equality at write gates and type-level callback separation. Reject B's mandatory host method and public worker report. Reject screenshot stripping for this increment. Full private report duplication is bounded to 8 MiB + 512 KiB per execution and 32 MiB aggregate per case. Establish those limits with actual durable-file tests.

A's first-baseline rule is corrected. If case.base is absent, selected baseline must match ready workspace binding.baseRevision. A browser receipt requires current non-null case.candidate. Reliable recording may occur during pause-requested while the same action remains authorized.

Native receives an unknown settled envelope, never an already trusted admission. Controller supplies a detached independent anchor and a revalidation closure. Ordinary callback returns remain simulated-only. A false-simulation artifact is only a fixed PNG manifest, not authority. The linked receipt owns execution provenance. Existing orphan/crash states remain valid and unassessable.

## Throughput checkpoint

- Blocking first steps. Full grounding, two designs and a fresh judge are complete. Baseline type checks and 37 focused tests pass.
- Independent workstreams. One implementation writer owns the native/controller/domain/artifact seam in an isolated worktree. Parent owns acceptance and documentation. Later GPT source and comment reviewers use distinct output artifacts.
- Shared mutable state. No concurrent implementation writes. Test data is temporary and case-local. Node dependencies are read-only shared via a stable symlink. Parent main remains unchanged during implementation.
- Smallest safe decomposition. The native receipt shape and authority closure are coupled and belong to one owner. Focused verification ends each unit. Parent performs complete verification only after writer completion to avoid overlapping full runs.

## Scope

Library-only `NativeCase.recordConsumedBrowserCheck` with optional RuntimeHost capability and real controller authority implementation. No run_check, production main or HTTP dispatch wiring. No Rust, dependencies, table/schema version, containment, monitored fixture, Docker, credentials, services, publication or deployment changes. Existing fault ordering and recovery tests stay intact.
