# Controller-owned offline workspaces

Trusted scripted callers can configure the controller to own synthetic source workspaces. Each admitted check receives one frozen source selection tied to its persisted action and epoch. The native operator and production entry point do not enable this configuration.

`WorkspaceStore` remains the sole Git and file-integrity owner. The controller catalogue owns case bindings, action authority and selection history. No additional database or coordinator is involved.

## Configuration

`Controller.open` accepts an optional `offlineWorkspace` object.

| Field | Value |
| --- | --- |
| `repositoryId` | A trusted branded repository UUID. Cases share the repository but have separate branches and worktrees. |
| `regressionDirectory` | The canonical virtual directory used by existing file-broker restrictions. |
| `baseline` | Synthetic virtual paths and file bytes, copied before the first await. No source-checkout path is accepted. |

The store is the private `workspaces` child of the controller directory. First enablement requires an empty catalogue. Existing scripted cases cannot silently acquire a source identity.

The catalogue records configuration identity and a bootstrap intent before store creation. Reopening requires the same repository, regression directory and baseline paths and bytes. Omitting offline configuration cannot downgrade an established offline catalogue to scripted-only operation. A missing, empty or foreign established store is not recreated.

## Check callback

Configured checks receive `check(request, source)`. Unconfigured checks retain exactly `check(request)`.

`request` remains the existing frozen `AdmittedCheckRequest`. `source` is an `OfflineActionWorkspace` exported from `src/controller.ts`.

| Member | Behavior |
| --- | --- |
| `selection` | Detached frozen case, Git revision and manifest digest. The controller chooses it before callback entry. |
| `readSelected()` | Returns fresh verified bytes for that exact recorded selection. It does not read the latest worktree. |
| `edit(expectedRevision, input)` | Uses the existing broker with a controller-generated request UUID. Input contains a virtual path, expected prior hash and copied replacement bytes. |

An edit requires the running implementation phase, the exact live persisted tool action, remaining allowance and an active callback. Existing path, revision, hash and quota restrictions still apply.

An edit from A to B does not change the callback's selection A. A later admitted action can select B. Source operations serialize their authority checks, storage effects and receipts. No SQLite transaction spans an await.

The controller revokes source handles when callback processing ends. Retained handles also reject after cancellation, action settlement, epoch change or controller close. A pause prevents new source operations. An edit admitted before pause can finish because the existing broker edit operation is not cancellable. Its completion does not authorize a later operation or a check receipt.

## Durable states

`workspace_bindings` stores one binding per case. `planned` permits first provisioning. `provisioning` records that an effect may have started. `ready` records the verified base revision. `uncertain` blocks execution, Continue and Retry.

Admission creates the planned binding with the case and issue guard in one catalogue transaction. Recovery of provisioning inspects rather than repeats the effect. Before recording ready, the controller freezes and reads the complete initial source. Its paths and byte hashes must match the captured configuration. Matching IDs and checkpoint sequence zero are insufficient. A ready workspace can legitimately have a current checkpoint different from its base.

`action_sources` retains the full admitted action and check kind. `selecting` records the intended checkpoint before freezing. `selected` records the frozen tuple before callback entry. `settled` records ordinary action completion. `interrupted` preserves a known tuple, if available, without retaining execution authority.

Recovery verifies historical frozen tuples even when the current worktree has advanced. Unfinished selections become interrupted. Orphan freezes do not prove callback execution. Missing, foreign or inconsistent associations block execution without marking healthy native storage missing. Paused and terminal dispositions remain unchanged. Recovery does not replay callbacks, edits or ambiguous provisioning. A healthy explicit Retry creates fresh authority.

Close disables new operations, drains admitted workspace operations and closes the store before the catalogue. Native-detail expiry does not remove workspace state. Workspace deletion and retention are not implemented here.

## Limits

Source selection is provenance, not validation evidence. `CheckResult.candidate` retains its existing simulated semantics and is not equated to the selected source SHA. Real browser reports and non-simulated receipts remain unaccepted.

The existing workspace lifetime quotas and shared-inventory uncertainty remain. Callback configuration identity does not certify callback behavior. Close does not prove that unrelated callback effects have drained. Same-UID hostile races, multi-process store ownership and power-loss durability remain outside the guarantee.

Docker dispatch, real source ingestion, model-edit tools, real fixture changes, credentials, live inference, publication and M2 acceptance remain deferred.

## Verification

`test/controller-workspace.test.ts` exercises public Controller behavior with real temporary Git and SQLite. It covers A/B selection, case isolation, stale authority, invalid associations, mode identity, close drainage and SIGKILL boundaries. Its post-native-close failure test injects an error only after the real close returns. It does not simulate a stuck native close.

The final commands and results are recorded in the [verification record](evidence/controller-workspace/verification.md).
