# Historical consumed-report query design

## Problem

An offline consumer needs retained evidence for one consumed acceptance. Existing opening recovers pending records and reconciliation changes cleanup. Neither is a historical query.

## Usage

```ts
const history = await FrozenBrowserValidator.readConsumedReport({
  directory,
  expectedIdentity,
  consumedRun,
});
if (history.state === 'settled') exportHistoricalReport(history.report);
```

## Shape

```ts
export type FrozenBrowserConsumedReport = Readonly<{
  consumedRun: FrozenBrowserConsumedRunKey;
  admittedAt: number;
  deadline: number;
}> & (
  | Readonly<{ state: 'pending' }>
  | Readonly<{ state: 'recorded' }>
  | Readonly<{ state: 'settled'; report: FrozenBrowserReport }>
);
```

One static command accepts the independently pinned journal identity and exact consumed selector. It returns detached historical data, not a receipt or authority. The worker module owns parsing and lifetime. No workspace argument or executable instance is required.

Reuse all existing retained parsers through a private acquisition branch. Historical acquisition opens only an existing journal, only read-only, and refuses any rollback sidecar before SQLite opens. It shares filesystem and record validation with current acquisition, then returns a private records/guard/close lease before writable reopening or mutable PRAGMAs. Existing writer paths retain their current behavior.

The command snapshots nested inputs before awaiting, selects the exact consumed acceptance and nested execution, guards files, projects the selected state, clones and closes privately. Missing or wrong identity and selectors reject. Pending and recorded states return no report. Settled reports preserve null evidence and incomplete cleanup. No normalization, finalization, schema upgrade, accounting charge, worker client or workspace access occurs.

The returned timing comes from the actual consumed intent. Report request allowance and shortened provenance timing remain unchanged. Ordinary report admission remains unchanged and rejects shortened consumed reports.

## Synthesis decision

Selected parent base is candidate B. Both candidates independently recommend one static query and reject a public reader handle. B's state union avoids A's second availability discriminant and duplicate RecoveryRun projection. A's test matrix strengthens no-effects, corrupt-unrelated-history and failure coverage. No implementation graft between competing codebases is needed because these are sketches.

| Criterion | A | B |
| --- | --- | --- |
| Independent pins and committed validation | Meets | Meets |
| No application recovery or worker effects | Meets | Meets |
| Truthful historical states | Meets, duplicated run projection | Meets, one state union |
| Small API and lifetime hiding | Meets | Meets with fewer returned fields |
| Parser reuse and scope | Meets | Meets |

Fresh GPT cross-judge 9d811c77 approves B as base with no blockers. Graft A's bounded private historical overload of acquireJournal instead of extracting a general acquisition core. Share only the filesystem guard where needed. Existing writer hot-journal recovery, writable reopening, broken-state checks, provisioning and drainage stay unchanged. Historical close guarantees ownership release, including on closure failure. Design approval does not establish implementation correctness.

## Tradeoffs

Whole-journal parsing is bounded and preserves existing trust checks. A rollback sidecar, even if cold, prevents retrieval until a separate recovery operation handles it. Ownership remains process-local. A historical cleanup observation is not current daemon quiescence. A private acquisition split is accepted to avoid a dummy workspace or an executable instance.

## Throughput checkpoint

- Blocking first steps. Grounding, two sketches and cross-judge disposition are complete. The approved contract precedes implementation.
- Independent workstreams. Designers and reviewers are read-only and use separate artifacts. One implementation owner writes source and tests.
- Shared mutable state. The implementation has a persistent isolated worktree. Existing journal exclusivity remains mandatory.
- Smallest safe decomposition. Acquisition and projection are one coupled worker seam. Focused checks gate that unit before full verification and fresh GPT review.

## Verification

The frame's verification contract remains authoritative. The test file is the rerunnable proof artifact. Scripted client checks are not live Docker evidence. Production main, native admission, actual fixture validation, M2 and later human gates remain open.
