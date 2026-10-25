# Prepare the live integrations

The default controller starts without credentials. Keep live remediation disabled until M0 through M5 pass and you explicitly enable M6. The separately invoked read-only connection probe below does not enable remediation.

## Review the 1Password account

1. Open the existing 1Password desktop application.
2. Select the intended company account explicitly.
3. Review who can create and manage a custom vault in that account.
4. Review the proposed `Eitri` vault's reader and writer access before creating it.
5. Approve the permissions before creating the vault or adding credentials.

Do not grant an all-team group, invite colleagues, or create a share link. Company owners and administrators can retain governance access. A custom company vault is not private from those roles.

Enable the desktop application's CLI integration when ready. Desktop approval can prompt during startup or explicit credential reload. Locking 1Password does not erase credentials already loaded into controller memory.

## Prepare the GitHub token

1. Open GitHub's fine-grained personal access token settings in your browser.
2. Select the repository owner and only `eitri-test-web-app`.
3. Grant repository Contents read and write permission.
4. Grant repository Pull requests read and write permission.
5. Keep the required Metadata read permission.
6. Set an expiry appropriate for the pilot.
7. Store the token directly in the reviewed vault as the password field in an item named `GitHub`.

The operator's existing item uses `op://Eitri/GitHub/password`, verified readable in the reviewed account `aurumcars.1password.eu`. The earlier proposed `/token` field does not exist; no rename is needed. Do not paste the token into chat, a terminal command, source, or a fixture environment file.

The [read-only GitHub checkpoint](evidence/github-preflight/verification.md) verifies that `pasTa4667/eitri-test-web-app` is private, uses default branch `master`, and already contains the exact local baseline and README. No baseline push is necessary. The operator confirms the token selects only this repository with Contents and Pull requests read/write, and approves `master` as the PR base. This is settings attestation: read success and the user's reported push permission do not independently prove token write scope. Future publication remains explicitly gated and uses session-specific fix branches, never direct fixes on the default branch. Do not rename `master` or replace the existing README.

## Check the existing hosted Sentry connection

The operator confirmed CLI integration and vault-access review, and supplied an existing hosted Sentry project: organization `pasta-re`, project ID `4512275993002064`. The operator has now selected this hosted project for M3 as well. It supersedes the local Sentry installation and installer-Bash prerequisite; do not install either for M3. Hosted selection alone does not establish M3 completion or change the live-remediation gates. Use existing account features without added spending. Synthetic hosted event delivery and review/assignment mutations still require deliberate operator action.

The API token is stored as the **password** field of `Eitri/Sentry`: `op://Eitri/Sentry/password`. No field rename is required. This must be a Sentry API token, not a browser SDK DSN. The item website may remain the supplied issues-page URL; it is not used as a credential destination.

```sh
op account list
npm run check:sentry -- --account <account-UUID-or-sign-in-hostname>
```

Select the reviewed company account explicitly. The probe uses the installed `/opt/homebrew/bin/op`, with desktop approval, to read only the fixed password reference into process memory. It excludes ambient `OP_*` credentials, bounds CLI output and execution time, and discards subprocess error details. It never prints the token or writes it to disk. Locking 1Password does not erase an already loaded copy; the one-shot process exits after the check.

The probe sends one GET to `https://sentry.io/api/0/organizations/pasta-re/issues/`, filtered to project `4512275993002064` with a one-issue limit and a 14-day window. Redirects are refused rather than forwarding authorization. Responses are time/size bounded and only a non-secret connection summary is printed. Zero sampled issues means the API returned an empty list, not that the project has no historical errors. An empty response cannot independently verify project existence or event-detail access.

Issue-list access requires `event:read` (or a broader existing scope). No write scope is needed for this check. A 401/403 requires checking token validity and access; a redirect/network failure requires reviewing the regional API origin before changing the fixed endpoint. Do not paste raw API or CLI output containing credentials into chat.

The earlier live connection check succeeded with zero sampled issues. The separately approved [monitored-build checkpoint](evidence/hosted-monitored/verification.md) now verifies four populated issues and their latest events, exact reported revision/environment and two-event grouping. Its validation build makes zero external requests even with a valid DSN. The temporary monitored build is stopped; do not send more events without another deliberate activation decision. The subsequent [review/assignment checkpoint](evidence/sentry-review/verification.md) verifies review and assignment to the explicitly selected Sentry user `5090062`. The token's authenticated identity is not an assignable organization member; do not use it as the owner by default. The operator has authorized Sentry reads/writes for this implementation work, but controller intake and live remediation remain disabled. The separate GitHub checks and operator confirmation now complete M3 setup; publication and live remediation remain gated.

To read one selected issue and its latest event, invoke the separate opt-in command:

```sh
npm run --silent observe:sentry -- --account <account-UUID-or-sign-in-hostname> --issue <positive-decimal-id>
```

The command reads the same fixed 1Password field once, then uses the [read-only observation interface](sentry-observation.md). It prints one JSON line. Use `--silent` to suppress npm's banner for machine consumption. The returned operational metadata is not anonymous. Live observation access is verified for the four synthetic hosted issues in the checkpoint, not every possible event shape. The command does not poll, write files, admit controller intake, or enable remediation.

Production polling, diagnostic-text ingestion, review/assignment dispatch, and controller wiring remain unimplemented. The controller must verify API permissions and behavior before enabling updates. `npm start` is unchanged and still runs only synthetic cases.

## Complete OpenAI sign-in at M4

Use the application's supported Pi OAuth login flow when implemented. Keep refreshable OAuth state in the private application directory, outside the repository and case files. Do not copy another CLI's credentials.

Select an available subscription model after sign-in. Approve the first small real tool-using inference before running it. A failed entitlement check stops this integration. No paid API key or other provider is a fallback.

## Keep operator actions explicit

Repository publication, live remediation enablement, merge, and activation of a new monitored build remain separate gates. The implementation does not merge or deploy fixes automatically.
