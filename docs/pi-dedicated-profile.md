# Offline dedicated Pi profile

This implements only the [next M4 offline task](build-plan.md#current-m4-subscription-access-slices), under the [operator's dedicated-profile/re-login decision](pi-auth-ownership.md#disposition). It does not enable production dispatch or establish live sign-in eligibility.

## Contract

`prototypes/pi-profile.mjs` takes an **explicit home**, with no ambient/default path. For tests this is a generated canonical temporary directory. Its fixed suffix is `Library/Application Support/eitri/pi/auth.json`, corresponding to the approved eventual macOS location. The home and each suffix directory must be owned by the current user, real directories and mode 0700; the existing auth file must be a single-link regular file, mode 0600 and at most 128 KiB. Missing/unsafe paths are refused, not initialized, chmodded, imported or repaired. No real home/profile is opened by these tests.

One atomic `mkdir` lease (`eitri-use`) excludes other Eitri profile users across processes. Its bounded private `owner.json` contains only a version and owning controller PID. A live owner is `profile-in-use`. Missing/invalid ownership, a dead owner, or a fixed `sign-in-required` marker blocks use as `sign-in-required`. PID liveness classifies a refusal; it never authorizes stealing a lease or killing a process. Pending/empty lease directories also block. Only the creator's successful callback removes its lease, after helper reaping and resource cleanup. A failed admitted use leaves the lease blocked, even when the underlying failure might not be auth-related. This deliberately favors re-login over diagnosing/retrying uncertain credentials.

The existing synthetic native adapter accepts trusted `profileHome` configuration outside the model protocol. With it, the stream-only child supplies supported `ModelRuntime.create({ authPath, modelsPath: null, allowModelNetwork: false, refreshOnCreate: false })`, **without** an injected credential store. Pi's built-in store owns reading/writing/rotation. `PI_CODING_AGENT_DIR` selects that same synthetic profile; helper HOME/cwd remain the action-owned empty directory. No API keys, normal HOME, Node injection variables or target-repository configuration are inherited. Fetch is forbidden before SDK construction. Before registering the provider (which starts background availability checks), metadata-only `listCredentials()` must report **exactly** the fixed synthetic route's OAuth entry. Additional providers and API-key entries are refused before the SDK can resolve any command-valued key. A subsequent OAuth auth check is also required; no login, alternate route or key fallback is attempted. The existing in-memory fixture remains the default when no profile is selected.

The opt-in `profile-refresh` fixture exercises Pi's real file persistence using a synthetic OAuth provider's fixed refresh result. It is **not** OpenAI renewal, JWKS/identity validation, network access or a new OAuth implementation. The existing built-in OpenAI OAuth characterization remains separate. The selected-source manifest now also pins the installed built-in auth-storage implementation; project dependencies remain 1.3.0, installed SDK 1.4.0 unchanged.

## Native lifecycle

A trusted adapter can reject drainage with `ControlError('sign-in-required')`. Native still waits for drainage and normal lifetime checks, suppresses terminal success, uses fixed transcript errors and passes only that finite failure classification to controller accounting. The controller parks current running work as Needs attention / `sign-in-required`. Deadline/allowance expiry keeps its existing timeout reason; pending Pause keeps its existing Paused state. The profile remains blocked in both cases, so Continue/new work cannot reuse uncertain auth. No phase, epoch, receipt, repair counter or allowance is reset by profile handling.

On abrupt parent death, existing owned-helper reconciliation still runs **before** controller recovery. A live orphan blocks opening, then its exit and empty-home disposal permit recovery. The stale profile lease subsequently refuses any fresh helper; recovery may admit/retire a denied native model action but never retries profile auth. Paused recovery starts no action. Interrupted models retain the existing conservative 120-second charge and 480-second remainder. Repeated reopen does not renew the allowance or replay tools.

Credentials remain outside catalogue/case data, artifacts, transport, case expiry and worker mounts/environments. Only the trusted inference helper receives the non-secret auth **path** in its allowlisted environment. Production worker assets/configuration are unchanged; no worker is launched by these tests. A generated normal-profile sentinel and the actual synthetic file-backed profile both survive case-detail cleanup.

## Verification

```sh
node --test test/pi-profile.test.mjs test/pi-native-profile.test.mjs
npm run verify:all
```

The focused suites cover explicit selection, permissions, links/size, non-initialization, same-process/cross-process exclusion, failed and abruptly interrupted use, malformed/missing/non-OAuth/expired credentials, Pi-owned synthetic rotation/reuse, native error parking, helper disposal, Pause/Continue, deadlines, parent SIGKILL with a live orphan, preserved budgets and terminal detail expiry. The [five-axis author review](evidence/pi-runtime/profile-review.md) records the final full-suite result and limitations.

## Remaining gates

Supported operator-present sign-in in the dedicated profile is next and requires separate approval. This offline increment provides **no login command or lease-reset/recovery command**. A future approved re-login flow must reconcile/reap all owners, sign in through Pi and explicitly clear uncertainty before allowing work; never delete a live lease, auto-repair tokens or silently reset the budget. Do not use these synthetic-only helpers with real credentials. The normal-profile success is not dedicated-profile eligibility proof. Genuine controlled tool use, production route selection and full M4 acceptance remain open.

This is process-crash testing, not fsync/power-loss durability, malicious-same-user filesystem-race protection, arbitrary independent-client concurrency or lossless rotating-token persistence. Other Pi clients must not use the Eitri profile. Possible login loss is the accepted v1 trade-off, not a proven safe refresh drain.
