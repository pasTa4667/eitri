# Admitted check execution boundary

## Goal and current evidence

Implement the next bounded unit after source integration c045082. The accepted browser validator remains unwired. Existing grounding is docs/evidence/validator-integration/validator-next-how.md and the source-only verification record. Existing controller/native/domain files are unchanged since that grounding. Read their current definitions before designing.

Controller Options.check currently receives case ID, check kind and signal but no admitted action. NativeCase already admits a tool Action before invoking the callback. Native evidence storage guards its action and epoch only after callback execution. CheckResult currently collapses every validation failure into passed=false. Such a receipt can send the case into implementation and consume a repair candidate. Infrastructure or unrelated failures must not become speculative source repairs.

## Scope and data shape

The conceptual input is an immutable host-owned admitted-check request. It binds the actual case/action/epoch, requested check kind and remaining action allowance to the cancellation signal. The controller validates dispatch authority immediately before invoking the configured callback. Do not pass mutable authority shared with controller bookkeeping. Choose the concrete request and callback signatures in the design.

The conceptual output is a discriminated execution result. One variant carries an ordinary CheckResult. Other outcomes represent unavailable or unreliable validation rather than a behavioral failed check. Use the smallest finite domain shape that distinguishes reliable completed checks from infrastructure, unrelated failure, cancellation, uncertainty and incomplete cleanup without optional-field combinations. Do not expose validator wire/storage/provenance objects through this API.

Synthetic callback outcomes exercise the new boundary. The current simulated-only case/check/artifact guards remain intact. Do not import or convert FrozenBrowserReport, relabel real reports as simulated, enable Docker, add workspace ownership, or change native evidence persistence schemas. No controller interpretation of raw browser protocol is needed in this unit.

Migrate all existing check callback callers and test hosts in one wave. No legacy overload. Preserve ordinary scripted pass/fail receipt behavior, assessment gates and successful artifact recording. Non-behavior outcomes must not create a check or artifact or mutate candidate/failedCandidate/repairs. They conservatively stop progression and retain issue ownership under the existing control semantics. Do not silently override an operator pause.

## Constraints

No Docker or browser execution, original fixture changes, live model or provider, credential access, external service, push, PR, deployment, restriction change or dependencies. No HTTP/Rust protocol changes. No global timeout/drainage rewrite. A context signal and allowance do not establish real worker cleanup drainage; that future binding remains gated.

Use current Controller interface, real temporary SQLite/native stores and faux provider for runtime acceptance. No private-method casts in the new behavioral tests. Parse untrusted callback return values at the host boundary. Keep existing artifact limits and simulated-only admission. No generic executor framework, plugin registry, observer/run handle or speculative infrastructure.

## Required checks

- A scripted successful callback receives its own actual admitted action/case/epoch and requested kind with a bounded remaining allowance. The request cannot mutate the controller action. Capacity-two cases remain isolated.
- Dispatch is denied for expired allowance or invalid/stale action authority before callback effects. Cancellation and late results cannot admit evidence after the action loses authority.
- Ordinary completed pass/fail receipts still produce expected checks/artifacts and repair behavior through Controller.
- Each accepted non-behavior outcome parks or preserves pause conservatively without a successful check/artifact, speculative implementation phase, failedCandidate or repair increment. Malformed and contradictory callback results fail closed.
- Restart preserves the conservative disposition without replaying checks. No new runtime import of frozen-browser/workspace execution appears.
- Focused tests, full verify:all and fresh source/comment reviews pass.

## Candidate task

Produce a read-only design package using /Users/felix.langbein/.agents/skills/architect/references/runner-prompt.md and rationale-template.md. Show usage first, type/signature sketches, module ownership, failure and pause behavior, migration list and test matrix. Bodies can remain sketches. The parent will implement only after synthesis.

Consider at least two structurally distinct whole shapes. An explicit admitted request envelope versus an action-scoped execution capability are examples, not required choices. Recommend one and explain which complexity each hides or exposes. No source edits, Docker, tests, commits or child agents. Keep the package concise enough for a maintainer to compare in one sitting.
