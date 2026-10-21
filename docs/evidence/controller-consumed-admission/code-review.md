## Review

- Correct: One immediate historical query captures intent and independent pins; conversion uses only those pins and unwrapped settled history (`src/controller.ts:596–605`, `2263–2305`).
- Correct: Branch precedence, original request role/allowance, and conversion-error propagation match the contract (`src/controller.ts:2270–2305`).
- Correct: The outer promise is tracked synchronously and drained before storage closure, including rejected inspections (`src/controller.ts:602–603`, `2236–2253`).
- Correct: Reviewed the entire new test file. Coverage includes detachment, state combinations, identity/timing mismatches, queued capture, busy scopes, guard/closure failures, and immediate close. Documentation accurately limits this to offline observations without native admission or production wiring.

No issues found.

**Reviewed identities—parent-supplied, not independently measured:**
- HEAD: `411072d5b30d878848491166756928be535e0117`
- `.audit/review-source.patch` SHA256: `d38b0da10e4a9c69a9cf4fd31fd9da4bf6d2a0c256d141e1534e46a31deaaf5c`
- `test/controller-worker-consumed-admission.test.ts` SHA256: `c436e8f8903a90c546d5a36e09646fd6dd10c39267154ff8c97d890e709b183c`

Read-only review; no commands or tests executed.

- **Merge verdict: OK**