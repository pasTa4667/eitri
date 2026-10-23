# Protected profile-name probe

`FrozenBrowserValidator` accepts `profile-name-v1` for importing colleagues who need helper-level browser observations. Production dispatch does not select this scenario. It does not validate the React application or complete M2.

## Interface

The existing request shape is unchanged. `scenarioId` also accepts `profile-name-v1`. Trusted offline controller callers can set [`offlineWorkspace.workerScenarioId`](controller-workspace.md#browser-scenario-selection) to select this probe through the existing accepted-request and native-report handoff. Production main remains unconfigured.

```ts
const request = frozenBrowserRequest({
	frozen,
	action: { caseId, actionId, epoch },
	scenarioId: 'profile-name-v1',
	role: 'candidate',
	allowanceMs: 60000,
});
const report = await validator.validate(request, signal);
```

The [capture operation](fixture-profile-name.md) supplies only the helper bytes. Existing workspace provisioning, editing, freezing, and verified frozen reads supply managed baseline and candidate identities. No capture-binding API or caller-controlled expectations are added.

## Fixed contract

The protected definition owns the helper route `src/lib/errors.js`, export `getUserDisplayName`, nine ordered inputs, expected strings, reviewed capture identity, and baseline exception fingerprint.

The fixed cases exercise missing profile, trimmed mixed-case names, a second name, blank name, missing name, null name, null profile, null user, and undefined user. Nonblank string names retain their case after trimming. Missing or blank values return `Anonymous`. Arbitrary type coercion and general input coverage are outside this finite contract.

One browser page runs the ordered calls with fresh literal arguments. Results describe sequential execution, not isolated calls or complete correctness.

The [reconciled baseline](evidence/profile-reconciliation/verification.md) has 534 bytes and source SHA-256 `cd69431e5b7fda7ec116377d033d192a7b214a9c42a8101bd8c809c862af80f4`. Its capture digest is `709e1a12ba7bfd02a33adb2d12b9f13c2cf5c831b1c224943b10bee111b65fe0`. These identities describe an `uncommitted-copy`, not an original Git revision or authenticated source provenance.

## Protected measurement

The driver serves a fixed inert document and wrapper module. The wrapper statically imports the designated helper export. It does not re-export `then`. The profile server does not load snapshot HTML or other project modules.

CDP obtains the wrapper's own function export and invokes its remote handle. The trusted call declaration returns only a bounded primitive string or a fixed non-string tag. It does not await returned thenables, serialize candidate objects, call candidate-replaceable utility methods, inspect thrown candidate properties, or accept DOM and console pass markers.

Only the byte-pinned reviewed helper permits native exception property reads. Its designated missing-profile call must produce the measured native TypeError, message `Cannot read properties of undefined (reading 'name')`, and first frame `at getUserDisplayName (/src/lib/errors.js:5:23)`. Normalization removes only the actual local origin. The reconciled baseline returns the expected formatted names and missing-name fallbacks. Missing or null user/profile inputs still throw. These observations remain separate from the designated diagnostic.

The driver creates the vector in its own memory. The host validates case identities, vector completeness, protected definition digest, actual helper manifest, and classification. The screenshot displays the measured vector on a separate trusted page after the candidate page closes. It illustrates evidence but does not determine the outcome.

## Outcomes

- `baseline-reproduced` requires the reviewed helper identity, designated diagnostic, complete suite, and clean execution. It does not establish normal-path compatibility.
- `baseline-not-reproduced` means the reviewed baseline did not supply the designated diagnostic during a complete clean probe.
- `candidate-passed` requires every exact expected string.
- `candidate-failed` includes wrong strings, invalid returns, and invocation exceptions.
- Import, syntax, missing-export, unexpected navigation, and execution-stage failures do not count as reproduction or candidate success.

Existing evidence, event, deadline, PNG, process-census, provenance, and cleanup requirements still apply. Pure report conversion validates consistency, not execution authorship or controller authority.

## Configuration and history

The protected definition joins the existing trusted scenario asset. Its bytes, driver bytes, and existing execution configuration contribute to the configuration digest. Scenario selection comes from the admitted request and is included in inspected container bindings.

Fresh synthetic runs retain their existing A/B meaning under the new configuration identity. Journals with incompatible earlier identities fail closed. They are not silently migrated or reinterpreted.

## Limits

The suite can reject constant fallback and partial fixes, but it cannot exclude hardcoding every fixed input. It neither reconciles the demonstration project's protected tests nor validates its build, UI, other helpers, or Sentry behavior. Production controller dispatch remains disabled. The probe does not enable genuine model inference, publication, or deployment.

Actual Docker acceptance and GPT review are recorded separately in the work log when complete. Fast tests alone are not browser or containment acceptance.
