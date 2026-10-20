# Worker correctness review

## Verdict

PASS. No evidence-backed P0 or P1 findings.

Reviewed `b16c629..9b4869349b4de91b0cc43dd77547df157eb479fe`. HEAD matches the requested identity. All five file hashes match `.audit/worker-committed-identity.txt`. The supplied patch matches Git output byte for byte. The working tree and index are clean.

## Contract trace

- `src/frozen-browser.ts:880-1046` preserves strict ordinary timing parsing and validates nested consumption against its explicit shortened allowance, original acceptance and retained request.
- `:1748-1800` validates version-specific records, durable accounting, capacity, action uniqueness and cross-kind UUID uniqueness.
- `:1048-1104`, `:1489-1495`, `:1830-1847`, `:1880-1908` and `:1973-1984` include nested executions in traversal, recovery, inventory and saves. Pending inventory is detached and does not await settlement.
- `:2067-2139` snapshots the complete acceptance, validates synchronous allowance and registers ownership before asynchronous admission. Concurrent same-acceptance calls join one run.
- `:2140-2220` atomically stages pending consumption, version 3 and quota. Worker time precedes each allowance sample. The endpoint remains fixed and uses safe arithmetic.
- `:2203-2217` checks authority after staging and immediately before COMMIT. Denial rolls back without charging or upgrading. Ambiguous persistence and rollback failures poison the handle.
- `:2112-2127`, `:2221-2250` and `:2309-2710` reject backward clocks and guard forward effects, including after awaited preparation. Offset clocks use remaining-duration translation. Later checks cannot extend the endpoint.
- `:1830-1847` records reopened pending consumption as uncertainty without replay. Consumption-only opening does not finalize historical work.
- `:2880-2968` retains resource ownership checks and unresolved cleanup. Cleanup does not require forward authority. `:2970-2991` drains registered consumption, saves and reads before releasing storage ownership.

Consumption returns no evidence bytes. `admitFrozenBrowserReport()` remains unchanged. Tests confirm that shortened consumption timing cannot pass its ordinary report-admission rule.

Controller integration is intentionally absent and was not treated as a worker defect.

## Independent checks

- Consumption suite passed all 28 tests.
- Acceptance and journal compatibility suites passed all 17 reported tests.
- Tests used temporary SQLite, synthetic executable effects and actual SIGKILL subprocesses.
- Exact patch comparison, all five identity hashes and `git diff --check` passed.
- No added comments or suppressions were found.

Read poteto-mode in full, including Principles, before substantive work. **Prove It Works** changed verification to independent execution and artifact comparison rather than reliance on supplied results. Its leaf skill was read in full.

Throughput checkpoint is n/a, read-only investigation.

## Residual risks

Controller lifetime integration requires its separate review. Full static and repository-wide gates were not independently rerun. No real Docker, credentials, monitored fixtures, production routes or benchmarks were used. Daemon, hard real-time and additional power-loss guarantees were not evaluated.

The requested external report write was blocked by the tool boundary. This response supplies the complete report for runtime persistence.