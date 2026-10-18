# eitri

Local Sentry investigation and fix-PR pilot. M0's durable TypeScript controller is implemented and verified with scripted adapters. Native UI, sandboxed execution, and live integrations remain staged by the [build plan](docs/build-plan.md).

## Check this checkout

Use Node 26.5.0.

```sh
npm ci --ignore-scripts
npm run verify
npm run doctor
npm run check:sdk
npm run probe:sdk
```

`verify` type-checks and runs the native-SQLite, control, recovery, and HTTP tests. `doctor` reports local prerequisites without reading secrets; installer Bash remains missing until M3. `check:sdk` accepts only the operator-reviewed package/source hashes and fails on unreviewed differences.

`probe:sdk` runs a throwaway faux-model experiment against a temporary real Pi SQLite store. It is not a live inference or the M0 controller.

## Run the scripted controller

```sh
npm start
```

The controller binds `127.0.0.1:43127`. Data defaults to `~/Library/Application Support/eitri`; set `EITRI_DATA_DIR` to select a private test directory. The mode-0600 `connection.json` contains the current bearer capability. Do not copy it into chat or a URL. `Check now` admits only synthetic issues. No live provider or publication route is enabled.

## Review the setup and progress

- [Manual integration setup](docs/setup.md) lists the company-vault, token, sign-in, and live-mode gates.
- [SDK review](docs/sdk-review.md) describes the observed API differences and the recommended dependency decision.
- [Work log](docs/work-log.md) records the workflow, milestone checklist, and continuation checkpoint.
- [Decision trail](decisions.tsv) records choices and evidence.

No provider credentials, containers, live inference, repository push, or live remediation have been created by this implementation run.
