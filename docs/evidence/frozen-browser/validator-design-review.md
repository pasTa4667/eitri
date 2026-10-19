## Review

Read both candidates entirely. Source checkout resolves to `09dd3372ca5c9966c47800b89cadcb4fc42b3ac7`; no tracked working-tree changes were reported. No tests or Docker were run.

### Scores

0 = inadequate, 1 = partial/costly, 2 = strong.

| Criterion | A | B |
|---|---:|---:|
| Retention after failures/unresolved daemon effects | 2 | 2 |
| Minimal API/schema coupling | 2 | 1 |
| Meaningful running-cancellation witness | 2 | 1 |
| Failure-safe dependent cleanup | 2 | 2 |
| Runnable regression evidence | 1 | 1 |
| **Total** | **9/10** | **7/10** |

- **Correct:** A removes the unsafe deletion decision entirely. Current teardown deletes unless explicitly pinned (`test/integration/frozen-browser.test.ts:97–103`); production `close()` drains active work but supplies no general resource-absence proof (`src/frozen-browser.ts:2077–2089`). Unconditional retention is safe for this acceptance step.
- **Correct:** B’s fail-closed reclamation policy is defensible in principle, but its “Positive reclamation proof” duplicates durable-schema knowledge and requires comprehensive writer shutdown. Automatic reclamation provides no required benefit here.
- **Finding — P1:** B’s “Usage first” cancellation snippet aborts in `finally` but does not drain validation there. A failed assertion skips subsequent awaits. Its regression plan recognizes draining; the implementation contract must explicitly require it.
- **Finding — P2:** Both regression sections describe tests, not executable evidence. Neither candidate demonstrates a passing harness regression.

### Recommendation: A base; narrow B grafts

Use **A’s unconditional retention**, private dependent remover, and observed-running assertion. Graft B’s explicit requirements to attempt every close and **await terminated child processes**. Do not graft the cleanup stack API, reclamation decoder, retention union, or deletion gate.

Early dependent-name registration enables later lookup; it **does not prove absence after a lost create response**. A successful empty listing can precede a delayed daemon effect. Keep accounting unconditionally, report unresolved cleanup visibly, and never equate client termination with daemon completion.

### Compact implementation contract

1. Print the root and validator directory immediately after root creation, before provisioning. Remove `retainState()` and fixture-root deletion entirely.
2. Register closure as handles are acquired. Attempt validator and workspace closure independently; preserve failures. Kill and await owned children where necessary.
3. Register dependent cleanup **before create**. Verify exact name and fixed label; remove only the verified immutable ID, without force. Share one idempotent operation between inline removal and teardown. Lookup/removal/confirmation errors fail visibly; unresolved create remains unresolved.
4. Require successful inspection of the **acquired owned ID reporting `running`** before intentional cancellation. A valid acquired ID alone is insufficient (`test/integration/frozen-browser.test.ts:358–379`).
5. Attach a rejection observer immediately when validation starts. Enclose polling/assertions in failure-safe cleanup that always aborts and awaits validation, even when inspection or the running assertion fails. Preserve the primary failure and any drain failure.
6. Preserve existing cancelled-outcome, owned-removal, sentinel, incomplete-cleanup, and reconciliation assertions.

### Exact regression minimum

Add one small harness-only regression file, without importing the Docker-gated suite:

- **Retention:** success, pending, unknown-build, incomplete cleanup, and partial setup all retain root/accounting/workspace and print paths; validator-close failure still closes workspace.
- **Dependent cleanup:** assertion immediately after create invokes teardown; inline-plus-hook removal is idempotent; wrong label or failed lookup/removal/confirmation fails without broadening deletion authority; lost response remains accounted for, including delayed appearance.
- **Cancellation:** created-only observations fail the running assertion but abort/drain; inspection failure and validation rejection also drain without unhandled rejection; running observation permits intentional cancellation.

Run `node --test test/frozen-browser-harness.test.ts`, then `npm run verify`. Actual-Docker evidence remains separately approval-gated: rerun the protected unknown-build reproduction without a pin and the existing cancellation/crash-boundary cases.

**Merge verdict: OK with notes for A as the implementation plan; implementation acceptance requires the focused regressions above.**