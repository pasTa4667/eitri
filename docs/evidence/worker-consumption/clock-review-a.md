# Clock-boundary review

## Verdict

The current implementation is incorrect under ordinary clocks. The smallest defensible correction is to retain the translated deadline as an immutable maximum and bound each forward effect by fresh controller allowance. Full-future-coverage equality is the wrong invariant.

This recommendation changes the selected admission contract. It does not approve a workaround or claim implementation verification.

throughput checkpoint: n/a, read-only investigation

## Scope and evidence

I read the assignment, selected contract, all three interrogate references, worker timing and settlement paths, and the controller diff.

The controller and scope hashes match `.audit/controller-review-identity.txt`:

- `src/controller.ts` has SHA-256 `b4ba3ca98fb2f9ace4ea55f73f9831f2187e9d438511ce3265be08d77cc8a432`.
- `src/worker-execution-scope.ts` has SHA-256 `2575444b89ccaee4cabe910b688871eeda6cfffb27ec8971a6f753980aaa3894`.

The checkout reached HEAD `7da32fa39aecfd1b104c18a943c8c4d3fdc5711e` during this review. These source hashes remained unchanged. I made no source edits.

## Findings

### 1. Critical. Full-future coverage compares different sampling instants

**Location.** `src/frozen-browser.ts:2155-2157`, `2204-2206`, and `2223-2225`.

The worker samples its time before invoking the controller sampler. The returned allowance describes a later controller observation. The predicate treats both observations as simultaneous.

Let both clocks advance at the same rate, with unrelated origins:

```text
Initial worker sample       W0
Initial sampler latency     L0
Initial controller endpoint D

Translated deadline         T = translated(D) - L0
Later worker sample         W1
Later sampler latency       L1
Later returned allowance    R1 = translated(D) - W1 - L1

Current coverage test       T - W1 <= R1
Equivalent condition        L1 <= L0
```

With an unchanged controller endpoint, the implementation requires every later sampler to be no slower than the initial sampler. Ordinary synchronous latency therefore becomes authority loss.

This effectively subtracts the later sampling interval twice. The allowance already excludes that interval, while `deadline - now` starts before it.

The controller sampler contains real work. `src/controller.ts:1351-1353` calls `assertCurrentAuthority()`, which reaches `checkAllowance()`, then calls `checkAllowance()` again. `actionAllowance()` samples its clock before charging and saving SQLite state at lines 1212-1215. The allowance can therefore already be older than the sampler return.

**Observed reproduction.**

Running the supplied default-clock integration test produced two successes and two failures. Both failures returned `worker-authority-denied` instead of `baseline-reproduced`. This confirms timing-dependent behavior, rather than unconditional rejection.

Two additional bounded checks called the real consumption implementation with actual fixture SQLite and deterministic clocks:

| Case | Sampler latency | Observed result |
|---|---|---|
| Final staging | Initial translation 1 ms, final sample 2 ms | Rejected with controller time 2003 and endpoint 2100. No charge or upgrade. |
| First forward guard | Initial translation 1 ms, final sample 1 ms, forward sample 2 ms | Charged once, then settled cancelled with no client calls. Controller time was 2004 and endpoint 2100. |

Both checks passed their assertions against the defective behavior. Neither invoked Docker.

The supplied diagnostic independently shows the same problem. Its fixed deadline is `1792520276101`. The later wrapper records allowance `57094` and worker-before `1792520219007`. Their difference is also `57094`, but the worker samples before entering the wrapper. A preceding worker millisecond makes the predicate fail despite roughly 57 seconds of controller authority.

### 2. Critical amendment requirement. Removing coverage alone leaves client deadlines insufficient

**Location.** `src/frozen-browser.ts:2302-2335` and `2443-2446`.

The current client guard returns no timing budget. Child timeout and the execution timer use only the translated worker deadline.

If full-future coverage becomes a positive-authority check without another change, a shortened controller allowance can authorize a new client whose timeout still reaches the older maximum. Controller cancellation is necessary, but should not be the sole enforcement mechanism for a budget the worker has already observed.

The clock correction must carry a fresh effect bound into client timeout calculation. Deleting the coverage comparison alone is not sufficient.

## Recommended contract

### Preserve the durable maximum

Keep the existing conservative initial translation:

```text
B0 = worker time immediately before sampling controller allowance
R0 = validated positive controller allowance
T  = B0 + min(R0, original request allowance)
```

Keep safe-integer arithmetic and monotonic worker-clock validation.

Persist `T` once. Never move it forward. Preserve the original acceptance unchanged.

### Bracket subsequent authority observations

For final admission and each forward boundary:

```text
B = validated worker time before the synchronous sampler
R = validated positive controller allowance
A = validated worker time after the sampler

E = min(T, B + R)
```

Require safe arithmetic and `A < E`. Equality denies.

`E` is an ephemeral effect bound. It is not a replacement durable deadline or a permission renewal.

The sampler's clock observation occurs somewhere inside `[B, A]`. Anchoring its allowance at `B` is conservative. Anchoring it at `A` can add the sampler interval to permission.

### Final post-staging admission

After staging all accounting and consumption writes:

1. Obtain the bracket and validate current identity, scope, signal, clocks, and allowance.
2. Require `A < E`.
3. Commit synchronously without another await or caller hook.
4. Leave the persisted maximum `T` unchanged.

Do not require `T - B <= R`.

If authority expires during staging or sampling, roll back without charge or format transition. Retain the existing poisoned-handle behavior for ambiguous storage failure.

This amends the selected contract. Final admission proves current permission to commit and proceed, not permission to occupy every instant up to the maximum `T`.

### Forward effects and timeout

A forward guard must establish both:

- The immutable worker maximum has not expired.
- Fresh controller authority permits positive remaining execution time.

For a new client, use at most:

```text
duration = E - A
```

Use that bound for the client timeout, including elapsed synchronous preparation before spawn. Recheck after awaited preparation. Preserve controller-signal cancellation and the original execution timer. Never renew the original maximum timer.

Cleanup must continue without forward authority.

### Why this cannot extend permission

Under the shared millisecond-rate assumption already required by translating durations between these clocks:

```text
B <= worker time corresponding to the controller observation
B + R <= translated current controller endpoint
E <= B + R
E <= T
```

Thus every effect is bounded by both the sampled controller endpoint and the original maximum.

A later observation can permit another effect only while both authorities remain live. It cannot increase `T`. A smaller controller allowance reduces the effect bound without requiring a durable deadline rewrite.

The ordered bracket is useful, but does not rescue full-future coverage. Comparing against `A` alone is unsafe. For example:

```text
T = 100
B = 10
controller observes at worker time 10 and returns R = 89
A = 12
```

`T - A <= R` passes, although the controller endpoint is 99 and `T` is 100.

I checked 45 bounded arithmetic combinations covering initial latency, later latency, and budget shortening. Every proposed effect endpoint stayed below both bounds. This is a supporting check, not implementation verification.

## Deterministic regression contract

### Required clock cases

1. **Nonzero translation and staging latency.** Use distinct clock origins and a fixed controller endpoint. Initial sampler latency is 1 ms and final latency is 2 ms. Admission succeeds if the conservative effect interval remains positive.

2. **Nonzero forward latency.** Initial and final sampler latency are 1 ms. A later forward sampler takes 2 ms. Consumption reaches the expected synthetic terminal outcome rather than cancelling.

3. **Late clock observation versus late sampler return.** Place the controller clock observation at different positions inside the bracket. Include synchronous work after that observation. Check timeout bounds against a literal controller endpoint.

4. **Budget shortening.** Shorten the controller allowance after translation and after staging. Require either denial when no positive effect interval remains, or execution bounded by the shortened allowance. Do not retain the old test's assumption that every positive shrink must reject.

5. **Exclusive equality.** Test `A = E - 1`, `A = E`, and `A = E + 1`. Only the first may proceed. Also test controller endpoint equality with wakeups withheld.

6. **Sampler consumes the available interval.** A positive returned allowance must not authorize work when the conservative bracket leaves no remaining time.

7. **Invalid clocks.** Reject backward, noninteger, nonfinite, and unsafe worker clocks. Retain controller backward-clock rejection and overflow checks for every endpoint calculation.

8. **Delayed preparation.** Delay journal opening and worker preparation before translation. Also delay preparation after a forward sample. Neither delay may renew permission.

### Required lifetime cases

Retain assertions for:

- One quota charge and one execution across concurrent joins.
- No replay after reopen.
- Immutable original acceptance and detached returned values.
- Post-staging denial without charge or format upgrade.
- Callback return, throw, interruption, and controller close revoking forward work.
- Owned cleanup and terminal settlement after revocation.
- Unknown build and incomplete cleanup preventing unsafe reuse.
- No evidence bytes escaping the callback consumption API.

### Default-clock integration

Run the existing actual-controller-clock, actual-SQLite, scripted-client path for baseline and candidate roles without clock patching.

Assert the expected terminal outcome, one build and start, one charge, owned cleanup, unchanged acceptance, and no replay.

Each invocation must succeed independently. Repeating until one succeeds is not a regression test.

## Lifetime review

I found no additional concrete controller lifetime or authority blocker in the inspected snapshot.

`WorkerExecutionScope` registers asynchronous operations for drainage, owns the lazy journal promise, and revokes before closing. Controller inspection obtains the held journal's inventory without holding the workspace queue through settlement. Controller close drains worker operations before workspace closure.

Worker recording and cleanup survive forward revocation. `saveNow()` converts a recorded non-uncertain outcome to cancelled when authority fails. `finalize()` performs ownership-checked cleanup without the forward signal. The deterministic forward-latency reproduction reached a settled cancelled row.

This conclusion does not claim daemon, crash-durability, production wiring, or hard realtime guarantees.

## Principles applied

- **Fix Root Causes.** I traced the rejection to incompatible sampling instants and rejected tolerance, retry, and frozen-clock fixes.
- **Prove It Works.** I ran the real default-clock reproducer and deterministic checks through actual consumption and SQLite rather than relying only on the timing equations.

## Residual risks

The proposed correction is not implemented or approved. Its timeout wiring and revised admission semantics require independent review and regression execution.

A numeric sampler cannot expose its exact internal observation instant. The conservative bracket can deny near exhaustion when it cannot prove remaining time. It does not require a jitter allowance.

Arbitrary clock-rate divergence and event-loop stalls are not solved by endpoint arithmetic. No hard realtime claim is made.

The artifact write tool rejected the requested external output path. This complete report is returned for runtime persistence at the authoritative path.