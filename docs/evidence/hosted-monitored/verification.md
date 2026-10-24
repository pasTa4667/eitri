# Hosted synthetic Sentry checkpoint

## Verdict and scope

**The populated-discovery and monitored-build M3 slices are complete. M3 itself remains incomplete.** The operator approved the read-only credential check, then separately approved preparing and activating the synthetic monitored build. No review/assignment mutation, resolution, reprioritization, GitHub write, model inference or live remediation occurred.

The original discovery returned an empty single page. The existing DSN was privately read from the sibling's ignored `.env` and verified against the selected project without printing its value. Only `op://Eitri/Sentry/password` in the explicitly selected `aurumcars.1password.eu` account supplied the API token. Credentials were never committed or passed to the browser/build process. The browser necessarily receives the public SDK DSN, not the API token.

## Source and activation

- Controller starting point: `9f8c51b`.
- Original fixture: `103db4755657e9a1595120164242a7b9323defcd`, unchanged on `master` with a clean tracked working tree.
- Monitored fixture: **`ee9e4ce173ca7eb1f9a0237af36cdc77c0e07a7b`**, tree `eda569adaf6c02157ed508c109a23d42a5b08f75`, on separate local branch `feat/monitored-sentry-revision`.
- Its worktree is `.audit/hosted-monitored/fixture`; the [source patch](monitored-fixture.patch) includes all four changed/added files. The original fixture README, dependencies, defects and protected behavior tests remain unchanged. Only reporting-specific tests change to require an explicit revision.

The instrument `scripts/check-monitored-sentry.mjs` pins that exact clean source commit and original lockfile hash. It exports committed bytes with Git archive, excludes `.env` and Git metadata, reuses already installed matching-lock dependencies, and makes fresh production Vite builds with a small subprocess environment. It does not install dependencies or execute a model-generated command. This is a trusted local monitored-build instrument, **not** a restricted-worker containment test or M2 policy expansion. Installed dependency bytes are reused, not independently reconstructed from the lockfile here.

Both builds contain the full source revision. Validation is deliberately built with the valid DSN too, so missing credentials cannot explain its silence. A temporary loopback-only static server serves immutable compiled HTML/JavaScript, never source maps. Chromium uses a fresh context per scenario, blocks service workers, and verifies actual response byte hashes against the build manifest. The server and browser are closed afterward. There is no persistent deployment, global service or background intake.

The demo runs each of the four scenarios twice: null profile, empty cart, expected invalid JSON, and deterministic transient upstream. Only the selected Sentry ingestion origin and exact project envelope endpoint are allowed beyond loopback. Redirects are refused. Each event is checked before transmission for exact revision, environment, stable scenario tag/fingerprint and a fixed synthetic error. Automatic integrations, session reports, client reports and logs are disabled. `beforeSend` drops arbitrary events and replaces exception text/frames and all other context with fixed synthetic metadata. SDK package/version metadata can still be added by the installed SDK. **No stack frames or original exception details are claimed as hosted evidence.**

## Actual hosted evidence

[activation.json](activation.json) is the original live record, retained with its **failed** harness verdict. Its validation build makes **zero external requests**. Its demo delivers **eight distinct events**, all HTTP **200**. The harness then incorrectly treats a browser-fulfillment/closing race after delivery as a request failure. That run is not relabeled as an end-to-end green browser run.

The live activation used the pre-repair working-tree instrument; its full pre-repair source hash was not recorded. The clean fixture revision and actual compiled-response manifests are retained. Final instrument source/tests are committed with this evidence.

No event is resent. The separate [read-only hosted confirmation](hosted-observations.json) links to the original record's SHA-256 and confirms latest-event identity, project, issue, reported `demo` environment and the exact revision. A historical-event GET also joins the earlier delivered event to the same issue for every pair, establishing actual grouping rather than inferring it from ingestion status.

| Scenario | Hosted issue | Native priority/status |
|---|---|---|
| Profile name | `155897738` | High / unresolved |
| Cart total | `155897731` | High / unresolved |
| Expected validation | `155897732` | High / unresolved |
| Transient upstream | `155897735` | High / unresolved |

These are observed native classifications, not local fix eligibility. In particular, High does not authorize fixing the expected/transient controls. Each latest event reports one exception and zero stack frames, consistent with the synthetic allowlist. The two reads are not an atomic Sentry snapshot. This verifies these specific hosted responses, not complete inventory coverage or future compatibility with every event shape.

Actual screenshots show the [profile error boundary](profile-name.png) and [transient control](transient-upstream.png). Intentional UI error boundaries are not application-success claims.

## Repairs, tests and review

- Reporting TDD: nine new tests initially have eight failures and one passing validation control. After implementation, all **39 fixture unit tests** pass, and a fresh production build succeeds. The monitored source is committed before activation.
- Instrument TDD: boundary tests first fail on the absent implementation, then pass. Two settlement regressions require retaining the delivered receipt while waiting for browser fulfillment and response disposal before closing a context.
- The first read-only grouping attempt fails: the global issue-event endpoint returns HTTP 401, while the existing observation library uses the organization-scoped endpoint successfully. An exact-URL regression fails on the global path, then passes after using the same organization-scoped path. No token expansion or replacement is needed.
- Corrected [offline browser verification](offline-verification.json) passes validation with zero external requests and both four-scenario demo rounds using local mocked ingestion. Its `transport: offline` receipts are **not hosted events**. This exercises the repaired browser lifecycle without transmitting another event. It is separate from the original failed live browser run and the passing actual read-only confirmation.
- `npm run verify:all` exits 0: **1,844 Node tests and 30 Rust tests pass**, including lint, formatting, type checks and native compilation. No failures, cancellations, skips or ignored Rust tests. Existing Rust dependency future-incompatibility notices remain. Final raw local log: `.audit/hosted-monitored/final-verify-all.txt` (exit 0). The earlier full run is also retained separately.
- `npm audit --omit=dev --ignore-scripts` on the monitored fixture reports **zero production-dependency vulnerabilities**. This is not an audit of dev dependencies or proof against unknown vulnerabilities.
- [Five-axis author review](review.md) records findings and applied feedback; no independent-agent or cross-family review is claimed.

## Reproduction and remaining gates

With the committed fixture worktree and the reviewed DSN available, `node scripts/check-monitored-sentry.mjs --validate` runs both builds and browser scenarios **without** remote delivery or token loading. `--activate` is a separate explicit opt-in which sends eight hosted events and reads the API token afterward. It requires a renewed deliberate operator decision before another live run; do not rerun it merely to obtain a green log. Importing the module performs no credential read or activation.

For read-only recovery of the already delivered events, import `observeDelivered` from that script and pass the `demo.receipts` from `activation.json`. Persist only its normalized result, never a raw response. It does not build, serve or send events. The actual successful recovery used this exact operation. Discovery, observation and grouping requests remain bounded, single-project reads with no controller intake.

Browsers and loopback servers are stopped. Private exports, build output and source maps remain under `.audit/hosted-monitored`; no physical erasure is claimed. Hosted events and the local fixture commit persist and cannot be undone by reverting the controller evidence commit. No remote deletion is attempted. The original fixture stays on its prior baseline.

The next M3 slice is **operator-approved review/assignment semantics**, without automatic resolution or priority changes. GitHub credential/privacy/default-branch and first-push gates also remain. No provider sign-in, inference, publication, merge, deployment or live-remediation permission follows from this checkpoint.

Official references: [Sentry SDK options and beforeSend](https://docs.sentry.io/platforms/javascript/guides/react/configuration/options/), [issue-event reads](https://docs.sentry.io/api/events/retrieve-an-issue-event/), [Vite build-time environment replacement](https://vite.dev/guide/env-and-mode). Installed SDK source was also checked for React ErrorBoundary scope propagation and post-beforeSend SDK metadata insertion.
