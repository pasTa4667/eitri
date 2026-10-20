# Independent clock review B

The current callback path is timing-dependent under default clocks. Retain the durable endpoint as a ceiling. Replace full-future coverage with freshly bounded forward effects.

throughput checkpoint: n/a, read-only investigation.

## Findings

### 1. [critical] Coverage compares incompatible sampling instants

**Location**: `src/frozen-browser.ts:2155-2157`, `2204-2206`, `2221-2225`.

The worker reads its time before invoking the controller sampler. It compares that earlier timestamp against an allowance calculated later. Both the final admission check and forward guards repeat this error.

The sampler performs synchronous database work. `src/controller.ts:1349-1353` calls `assertCurrentAuthority`, then `checkAllowance` again. The first call reaches `checkAllowance` through `sourceAuthority`. Each allowance calculation authenticates the action, reads the controller clock, charges the case and saves it.

The controller default clock uses `floor(performance.timeOrigin + performance.now())`. The worker uses `Date.now()`. Matching origins would not fix the incompatible observation times.

**Timing proof.** Let K be a fixed controller endpoint expressed in worker units. Let L0 be the delay between the initial worker timestamp and initial controller observation. Without the request cap, translation produces:

```text
T = K - L0
```

On a later sample, the worker timestamp is Wi and sampling delay is Li. Returned allowance is:

```text
Ri = K - Wi - Li
```

The current predicate requires:

```text
T - Wi <= Ri
Li <= L0
```

It therefore requires every subsequent sampler to be no slower than the initial sampler. This is not an expiration check.

**Independent reproduction.** I ran an inline synthetic check against the actual worker and temporary SQLite. Both clocks advanced consistently. Initial translation sampling consumed 2 ms. Final admission sampling consumed 5 ms. The sampler still returned 59993 ms. Consumption rejected `worker-authority-denied`. Assertions confirmed zero charge, version 2 and no scripted Docker commands.

I also reran the supplied default-clock integration suite without clock patches. Three cases failed `worker-authority-denied`; one passed. The parent captured four failures. The mixed result confirms timing dependence, not an acceptable retry strategy.

The supplied diagnostic records T = 1792520276101. Its last wrapper records worker-before 1792520219007, worker-after 1792520219008 and allowance 57094. The worker timestamp precedes that wrapper. These observations support the root cause, although they do not expose the exact earlier worker timestamp.

### 2. [critical] Removing coverage alone leaves stale in-flight timeout authority

**Location**: `src/frozen-browser.ts:2302-2328`, `2439-2446`.

`client` invokes the guard but receives no usable allowance. Its timeout uses only the original worker endpoint. Execution cancellation also uses that endpoint.

Replacing coverage with only `remaining > 0` would allow a newly dispatched client to outlive a shortened controller allowance. Controller abort propagation remains necessary, but cannot substitute for the fresh duration when wakeups are withheld.

Fresh-budget timeout propagation is part of the correction. Cleanup must retain its separate budget and must not depend on forward authority.

## Recommended contract amendment

Keep the existing acceptance schema, immutable original acceptance, atomic nested consumption and one-charge transaction.

Keep the initial translation after asynchronous preparation. Its T is an immutable maximum, not a guarantee that every future sample authorizes the entire interval through T.

Consolidate the duplicated coverage checks into one consumption-specific ordered sampling operation:

1. Read valid monotonic worker time B.
2. Invoke the synchronous current-authority sampler and obtain positive safe-integer R.
3. Read worker time A. Reject backward or invalid time, including changes during the sampler.
4. Recheck cancellation and handle state.
5. Compute `B + R` with checked arithmetic.
6. Set effective endpoint `H = min(previous H, T, B + R)`.
7. Require `A < H`. Equality denies.

The usable budget after sampling is equivalently:

```text
min(previous H - A, T - A, R - (A - B))
```

Keep H ephemeral. Never rewrite the admitted endpoint or acceptance history.

Apply this operation after SQL staging and immediately before COMMIT. A denied final sample rolls back without charge or format transition. No await or caller hook follows the final sample before COMMIT.

Apply it before forward effects and after awaited preparation. Give clients an absolute timeout no later than H. Do not turn an old allowance into `Date.now() + R`. Tighten consumption cancellation when H decreases. Never extend an existing cancellation endpoint. Preserve controller revocation, caller-signal cancellation and post-settlement delivery checks.

A monotonic elapsed measurement is preferable for charging the sampler interval. If fractional milliseconds are used, round elapsed duration upward. Continue rejecting observed backward worker wall time. This preserves the existing duration-translation assumption without silently repairing invalid clocks.

### Why this cannot renew permission

Each candidate anchors the returned duration at the beginning of its bracket. That is conservative relative to an observation inside the bracket. Charging the entire bracket also accounts for synchronous work after the controller reads its clock.

For every operation:

```text
Hn <= T
Hn <= Hn-1
```

Neither sampling, retries nor a later larger allowance can renew the admitted maximum.

With the deterministic reproduction, the initial ceiling is `K - 2`. The later candidate is `K - 5`. The corrected operation tightens H by 3 ms and retains ample positive permission. The current implementation instead rejects because those endpoints differ.

An ordered bracket does not rescue the original coverage contract:

| Rule | Result |
|---|---|
| Require `T <= B + R` | Preserves the false rejection when later sampling is slower. |
| Require `T <= A + R` | Can overstate full-endpoint coverage by the sampler interval. |
| Keep T as ceiling and bound each effect by H | Preserves a nonrenewable maximum and fresh operation authority. |

Moving one timestamp, freezing clocks, adding jitter tolerance or deleting timeout authority is insufficient.

The proof assumes compatible elapsed milliseconds, as the current cross-domain duration translation already does. Arbitrary unseen clock jumps cannot support a hard real-time guarantee through this synchronous sampler interface. Boundary checks and bounded client scheduling are the contract here, not daemon or hard real-time guarantees.

## Lifetime review

The supplied controller diff registers `WorkerExecutionScope` before callback entry. The scope captures a detached acceptance, exposes a zero-argument consumer, memoizes consumption and tracks owned operations.

Worker admission registers ownership before asynchronous journal work. Its mutation queue covers admission and saves rather than full execution. Consumption and quota charge share one transaction.

Callback return, throw and interruption revoke the scope. Controller close drains worker work before workspace storage closes. Active inspection uses the held journal rather than reopening its exclusive lease. Worker finalization and owned removal do not require forward authority.

I found no additional independently proven controller lifetime or authority blocker. This is not approval of the snapshot. The correction must preserve cleanup after cancellation and must not make close await arbitrary callback code.

## Deterministic regression contract

1. **Nonzero admission latency.** Use real SQLite and distinct clock origins. Initial sampler latency is 2 ms; final sampler latency is 5 ms. Expect admission, one charge, unchanged durable T and an effective endpoint tightened by 3 ms. Current code must fail.
2. **Nonzero forward latency.** Introduce sampler latency after admission with ample allowance. Expect normal execution and owned settlement. Assert client timeout includes sampler cost and never exceeds T.
3. **Exclusive equality.** Make final staging consume all effective permission. Test `A = H` and `A > H`. Expect rollback, no charge, no upgrade and no command.
4. **Shortened allowance.** Return positive authority below `T - A`. Hold a client beyond that budget with controller wakeups withheld. Expect cancellation and owned cleanup. A later larger allowance must not increase H.
5. **Delayed preparation.** Gate opening, workspace reading and journal preparation. Charge their elapsed time before forward admission. Preserve request caps and expiry denial.
6. **Sampler return latency.** Read controller time, then advance time before returning R. Charge the entire bracket once.
7. **Invalid clocks and samplers.** Retain backward/invalid clocks and zero, negative, fractional, unsafe, asynchronous and throwing sampler denial.
8. **Ownership invariants.** Retain concurrent joins, exact captured acceptance, one charge, immutable history, pending inspection, no replay on reopen and close during opening/client/cleanup. Revoke between terminal settlement and delivery. Delivery rejects while settlement remains inspectable.
9. **Default-clock integration.** Run the supplied suite without Date/performance patches or retries. Every invocation must settle successfully with owned cleanup and one charge. Deterministic latency tests supply the timing proof.

## Method and limitations

I read poteto-mode in full, including Principles, the selected design, reviewer prompt, rubric and code-quality lens.

Fix Root Causes changed the recommendation from tolerance to correcting incompatible sample instants. Laziness Protocol changed it to preserve the durable schema and consolidate guards rather than introduce another ledger.

No source edits, children, real Docker or live effects were used. The correction is not implemented or approved. Both attempts to write outside the worktree were denied by the harness, including the authoritative report path. This response contains the complete report for artifact persistence.