# eitri

Local Sentry investigation and fix-PR pilot. The application is not implemented yet. Work is paused at the SDK compatibility review required by the [build plan](docs/build-plan.md).

## Check this checkout

Use Node 26.5.0.

```sh
npm ci --ignore-scripts
npm run check
npm run doctor
npm run check:sdk
npm run probe:sdk
```

`check` checks JavaScript syntax. `doctor` reports local prerequisites without reading secrets. It currently exits 1 because the Sentry installer's newer Bash is missing. `check:sdk` exits 1 because the published SDK differs from the inspected commit. Neither failure is an application acceptance pass.

`probe:sdk` runs a throwaway faux-model experiment against a temporary real Pi SQLite store. It is not a live inference or the M0 controller.

## Review the setup and blocker

- [Manual integration setup](docs/setup.md) lists the company-vault, token, sign-in, and live-mode gates.
- [SDK review](docs/sdk-review.md) describes the observed API differences and the recommended dependency decision.
- [Work log](docs/work-log.md) records the workflow, milestone checklist, and continuation checkpoint.
- [Decision trail](decisions.tsv) records choices and evidence.

No provider credentials, containers, live inference, repository push, or remediation have been created by this implementation run.
