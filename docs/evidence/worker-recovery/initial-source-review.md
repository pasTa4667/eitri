# Independent source review

## Merge verdict

**Do not merge yet.** Two runtime mode-dispatch defects need fixes.

Reviewed the full changed source and tests for `d932d8c..6d94d000122539e44f063c1aa5a2ef9e04adcbf3`, plus both requested design artifacts.

The requested artifact write was blocked by the workspace restriction. This report is returned for persistence to the authoritative output path.

throughput checkpoint: n/a, read-only investigation

## Findings

### P1. Mutable options can turn journal-only opening into execution

**Location.** `src/frozen-browser.ts:1342-1347`, `1413`, `1569-1581`.

`open` reads `options.mode` after awaits instead of capturing the invocation's mode. Ordinary caller mutation changes existing-only enforcement, recovery effects, and the returned runtime capability.

Reproduced with a valid synthetic owned journal containing recorded uncertainty and image acquisition intent:

```js
const options = { directory, workspace, mode: 'journal-only' };
const opening = FrozenBrowserValidator.open(options);
delete options.mode;
const handle = await opening;
```

Observed:

- `typeof handle.validate === 'function'`.
- Opening invoked the private Docker sentinel with these arguments:

```json
["--context","orbstack","image","ls","--all","--no-trunc","--quiet","--filter","reference=eitri-frozen-browser:10000000-0000-4000-8000-000000000001"]
```

The same mutation on an empty directory created `journal.sqlite`, `owner.json`, and `seccomp.json`.

This contradicts journal-only existing-directory, no-worker-effects, and runtime-narrow-handle requirements. No journal tampering during ownership or malicious same-UID writer is needed.

**Smallest fix.** Capture and validate mode synchronously before the first await and before owner registration. Use that immutable local for every branch.

**Required coverage.** Mutate journal-only options immediately after invoking `open`, on empty and populated directories. Assert existing-only rejection or narrow inventory access, respectively, and no sentinel calls. Test the reverse mutation to preserve default execute behavior.

### P2. Malformed runtime modes silently grant execution capability

**Location.** `src/frozen-browser.ts:1342-1346`, `1413`, `1569-1576`.

Every value other than exact `'journal-only'` takes the execute branch. TypeScript overloads do not validate JavaScript or configuration-derived input.

Reproduced:

```js
const handle = await FrozenBrowserValidator.open({
  directory,
  workspace,
  mode: 'journal-onyl',
});
```

Observed `typeof handle.validate === 'function'` and initialization of all three journal ownership files in an empty private directory. Existing unresolved journals take the same effectful recovery branch demonstrated above.

**Smallest fix.** In the synchronous boundary parse, accept only omitted mode and `'journal-only'` under the current API. Reject other supplied values before initialization or recovery.

**Required coverage.** Reject misspelled strings, null, booleans, objects, and numbers. Assert unchanged directories/journals, no sentinel calls, and successful subsequent valid opening to detect owner-lock leaks.

## Other assessed contracts

No additional concrete blocker found.

- Ownership and integrity checks remain shared with execute opening. Focused tests cover independent schema, digest, configuration, identity, accounting, and evidence corruption.
- Pending recovery retains identity/accounting and records uncertainty with null evidence. Tests cover SIGKILL around admission and recovery COMMIT, plus save failure.
- Inventory snapshots detach nested values and retain acquisition state and historical cleanup.
- Close registers its closing state synchronously, rejects later reads, drains accepted reads, and retains owner exclusion until completion.
- No-effect tests use nonempty expected inventory, a throwing workspace proxy, and a Docker sentinel with a positive execute-mode control.
- Default execute logic is otherwise unchanged. Full regression completion remains unverified.

Existing journal tests always supply a stable literal mode. They miss both dispatch defects.

## Verification

Node was `v26.5.0`.

- Focused journal tests passed. **34 tests, zero failures or cancellations.**
- `npm run verify` passed lint, formatting, compilation, and syntax checks. The full test phase exceeded the 200-second command timeout. No full-suite pass is claimed.
- Inline synthetic SQLite/sentinel reproductions confirmed both findings. No real Docker ran. Temporary fixtures were removed.
- Source and staged diffs remained empty. Only the existing untracked `node_modules` entry appeared in status.

Boundary Discipline shaped the single boundary-parse recommendation. Prove It Works shaped the runtime reproduction rather than treating mutable reads alone as proof. Both principle leaf skills were read fully.

Residual risks include the incomplete full regression run and existing trusted-owner exclusions. This review establishes neither real Docker acceptance nor controller-worker authority correlation.