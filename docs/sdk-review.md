# Pi Durable compatibility review

## Current decision

The operator approved retaining published Pi Durable 1.3.0 and continuing against its actual API. The differences below remain documented; no dependency or safety contract was substituted. The approved hashes are fixed in `docs/evidence/sdk-approved.json`.

M0 now has a controller implementation with 21 passing native-SQLite, dispatch, recovery, lifecycle, and HTTP tests. Evidence is `docs/evidence/m0-tests.txt`. The compatibility prototype below remains throwaway and is not itself M0 acceptance.

## Reproduce the source comparison

Run `npm ci --ignore-scripts`, then `npm run check:sdk`.

The check compares selected published source maps against commit `8efd314fa3d3232ce197d8d7a6a5660530b9d83e`. It records source hashes and public signature differences in `docs/evidence/sdk-compatibility.json`. The reviewed hashes return `approved-differences` with exit code 0. Unexpected source or API differences still return `review-required` with exit code 1. Approval is not extended automatically to another package or upstream change.

| Contract | Inspected commit | Published 1.3.0 |
|---|---|---|
| `HarnessOptions.models` | `Models` or a function returning `Models` | `Models` |
| `HarnessOptions.settings` | Settings object or a function returning settings | Settings object |
| Per-model compaction overrides | `CompactionSettings.modelOverrides` | Absent |
| `ToolControl.terminate` | Optional boolean | Optional literal `true` |
| Selected Pi AI model-dispatch source | Reference source | Exact match |
| Selected Node SQLite adapter source | Reference source | Exact match |

The comparison covers five files, not the entire SDK or all transitive dependencies.

## Compatibility prototype

Run `npm run probe:sdk`. The throwaway program is `prototypes/sdk-compatibility.mjs`. It uses a temporary real SQLite file and a counting faux provider. It deletes only the temporary directory it created.

Observed results are retained in `docs/evidence/sdk-probe.json`.

- A passive native note left inference and tool execution counts at zero.
- A scripted tool-using turn completed with two model dispatches and one tool execution, despite a deliberately throwing non-tool hook.
- A provider-level denial prevented another underlying faux-provider dispatch. The denied submission settled unanswered.
- Closing and reopening the native database preserved its application document and note without another dispatch.

These observations support using a fixed `Models` object with guarded provider dispatch rather than requiring a function-valued `models` option. Per-model compaction settings are unnecessary when automatic compaction is disabled. Literal `terminate: true` supports the intended controller-owned phase boundary.

This is a limited feasibility observation. It does not prove safe pause during an in-flight action, budget recovery, compaction denial, OAuth refresh races, multi-case isolation, or production publication safety.

## Design candidates for M0

The caller's interface remains `snapshot`, `command`, and `watch` from the build plan. Neither candidate exports native database identifiers to GPUI.

| Candidate | Control ownership | Benefit | Cost |
|---|---|---|---|
| Controller-owned catalogue and native case adapter | Synchronous catalogue transactions hold admission, control versions, budget, and action intent. The case adapter owns native conversation and document commits. | The public controller interface hides cross-file provisioning and note-delivery recovery. Provider and tool dispatch consult one control authority. | Catalogue-to-native delivery needs durable, idempotent intents. |
| Native application-document event log with a catalogue projection | Native case documents own lifecycle transitions. The catalogue rebuilds cross-case control projections. | Case-local transitions share native commits with conversation changes. | Admission and dispatch would need to coordinate case-local state with a separate cross-case ownership authority. Projection lag could admit stale work. |

The first candidate is the recommended base. It follows the accepted catalogue authority and keeps admission atomic. The second candidate exposes two control authorities to the runner and conflicts with the plan's authoritative catalogue requirement. Native documents from the second candidate remain appropriate for rich assessments and evidence, not action permission.

The review rubric is atomic ownership, one dispatch authority, crash-recoverable cross-file handoff, no wakeup from reads or notes, and the depth of the three-method public interface. The first candidate meets the intended structure on paper. Runtime tests are still required.

No independent model judge was available. This harness has no subagent tool. The alternatives and prototype were examined sequentially by the same assistant.

## Resolved operator decision

Accepted published Pi Durable 1.3.0 with the documented differences. No Git snapshot replacement or newer SDK was selected.
