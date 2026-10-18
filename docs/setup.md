# Prepare the live integrations

Implementation starts without credentials. Keep live remediation disabled until M0 through M5 pass and you explicitly enable M6.

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
7. Store the token directly in the reviewed vault as a field named `token` in an item named `GitHub`.

`op://Eitri/GitHub/token` is a proposed reference, not evidence that the item exists. Do not paste the token into chat, a terminal command, source, or a fixture environment file.

The first push remains gated on verified repository privacy, default branch, and your confirmation of the target branch. Do not rename `master` or replace the existing README.

## Prepare the Sentry token after installation

1. Wait until the pinned local Sentry installation passes its readiness checks.
2. Create or select the demonstration project in the local Sentry interface.
3. Create an API token with the read permissions required for project issues and events.
4. Grant only the issue write permission needed for the selected review and assignment actions.
5. Store the token directly in the reviewed vault as a `token` field in an item named `Sentry`.

The controller must verify the installation's actual API permissions and behavior before enabling updates. The browser SDK DSN is not this API token. `op://Eitri/Sentry/token` is a proposed reference.

## Complete OpenAI sign-in at M4

Use the application's supported Pi OAuth login flow when implemented. Keep refreshable OAuth state in the private application directory, outside the repository and case files. Do not copy another CLI's credentials.

Select an available subscription model after sign-in. Approve the first small real tool-using inference before running it. A failed entitlement check stops this integration. No paid API key or other provider is a fallback.

## Keep operator actions explicit

Repository publication, live remediation enablement, merge, and activation of a new monitored build remain separate gates. The implementation does not merge or deploy fixes automatically.
