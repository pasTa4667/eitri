# Dedicated Pi profile sign-in

The operator explicitly approves implementing and verifying this login-only step. `npm run test:pi-login` provides the supported Pi sign-in flow for the dedicated Eitri profile. **The command is implemented and tested offline; actual dedicated-profile sign-in is not yet verified.** It does not enable inference, production dispatch, publication or a new billing route.

## Operator action

From the Eitri repository, in a real macOS terminal:

```sh
npm run test:pi-login -- --run
```

Complete the browser flow. Trust the **terminal** verdict, not the browser callback success page: the callback precedes token exchange/persistence. Share only the finite verdict, never credentials, callback URLs or authorization codes. `oauth-saved` means Pi completed sign-in and a new runtime sees the saved OAuth metadata. It does **not** verify inference entitlement, model/tool availability, workspace policy or full identity validation. No such claims are made by this wrapper.

On denial, stop and report the non-secret observation. There is no automatic retry, credential import, device-code/pasted-code fallback, alternate provider or paid-key fallback. Ctrl+C cancels; the disposable login process has a five-minute hard lifetime, including uncooperative SDK work.

After a failed/interrupted **login command**, once that command has exited, an explicitly chosen fresh sign-in can use:

```sh
npm run test:pi-login -- --run --recover
```

Do not automatically run this after a denial. It performs supported browser sign-in again, not a retry of saved uncertain tokens or a repair of credential bytes.

## Scope and ownership

The launcher uses the operating-system user's home, not ambient `HOME`, to select `~/Library/Application Support/eitri/pi/auth.json`. It re-executes the login process with a fixed allowlisted environment, empty temporary HOME/cwd, dedicated `PI_CODING_AGENT_DIR`, offline model-catalog mode and telemetry/version checks disabled. Ambient API keys, 1Password tokens, proxies, Node injection and normal Pi configuration are not inherited. The launcher waits for process closure and removes only its empty temporary home. Real sign-in still makes the necessary Pi/OpenAI OAuth requests and opens the system browser.

`prototypes/pi-profile-login.mjs` creates only missing suffix directories. Existing home/Library/Application Support must be canonical, user-owned, real directories without group/other write permission; `eitri` and `pi` must be 0700. Existing auth must be a user-owned single-link regular file, 0600 and at most 128 KiB. Unsafe paths are refused without chmod, token copying or deletion. Pi initializes and writes its own auth file. Malformed credentials, nonselected providers and API keys are refused before login/command-valued key resolution.

The login process owns the same atomic `eitri-use` directory as the [offline profile adapter](pi-dedicated-profile.md), using a distinct bounded version-2 record `{version, kind: "login", pid}`. Only this process uses credentials: no auth helper, agent session or model loop is spawned. Browser opening is a fixed `/usr/bin/open` call, with an allowlisted authorization origin/path/redirect; its URL is never printed by the wrapper. Credential values returned by Pi login are discarded, never forwarded or logged.

A successful login reopens Pi metadata, verifies OAuth-only selection and private auth permissions, then releases its own lease. Failure leaves the lease blocked. Ordinary login never reclaims it. Explicit `--recover` only replaces a version-2 login owner after PID probing returns **ESRCH**; a reused/live PID blocks. A `recovery` subdirectory serializes takeover while pinning the old lease directory. Pending records, interrupted recovery, unknown files and version-1 native leases all block. No PID is signaled by recovery, no lease is recursively deleted, and no auth-store lock is deleted. Ambiguous ownership requires investigation, not manual blind removal.

Version-1 native leases cannot establish helper exit from their controller PID alone; this command deliberately does not reset them. Real native credential dispatch is still disabled, so these remain a future production-integration gate, not authorization to point the synthetic adapter at real credentials. No catalogue/case state, pause flag, repair counter or allowance is opened or reset by login. Successful sign-in never automatically resumes a case.

## Supported Pi surface

The already-reviewed installed **1.4.0** package/source identities are checked before profile access. Project packages stay pinned at **1.3.0**. Only public `ModelRuntime.create({authPath, modelsPath: null, allowModelNetwork: false, refreshOnCreate: false})`, metadata-only `listCredentials()` and `login('openai-codex', 'oauth', interaction)` are used. Pi's unmodified built-in browser login and file store own OAuth. There is no internal AuthStorage import, custom credential store, `getAuth`, refresh call, RPC prompt, CLI agent session or new dependency.

Installed references: `docs/sdk.md`, `docs/providers.md`, `docs/environment-variables.md`, `examples/sdk/09-api-keys-and-oauth.ts` and `dist/core/model-runtime.d.ts` under `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/`. These establish supported configuration/login surfaces, not guaranteed crash-safe rotation. The [accepted re-login trade-off](pi-auth-ownership.md#disposition) still applies.

## Evidence and remaining gate

The [five-axis author review](evidence/pi-runtime/profile-login-review.md) records 27 focused tests and full verification. Tests use generated homes, the real installed built-in Pi login/file store, mocked browser/callback/token transport and synthetic tokens. The SIGKILL check retains a live login owner, refuses competing recovery, waits for its actual exit, then requires explicit fresh sign-in; normal-profile and case-state sentinels survive. This is not real eligibility or general native recovery proof.

**Next:** run the approved operator-present command and record its terminal verdict/exit status. Keep the plan's real sign-in checkbox open until that observation exists. On success, stop before the separately approved genuine controlled tool-using turn; M4 and production-route selection remain open.
