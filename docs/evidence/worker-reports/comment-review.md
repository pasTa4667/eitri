# Comment audit

- Touched source files. None.
- Deletion count. 0 actual, 0 recommended.
- MUST KILL flags. None.
- Keep `src/frozen-browser.ts:105`, `FrozenBrowserConsumedReport`. This exported type's doc comment defines its detached, historical, non-authoritative contract.
- Keep `src/frozen-browser.ts:1769`, `FrozenBrowserValidator.readConsumedReport`. This public method's doc comment defines its no-recovery, no-worker-effects, no-admission contract.
- Skips. Unchanged source comments are outside scope. The new test contains no comments or suppressions. No scoped source suppressions were added.
- Prove It Works shaped verification. Read both exact current files completely, inspected the diff against `94af4e8`, and repeated their hashes.

## SHA-256 hashes

- `src/frozen-browser.ts`. `943367ac519af74b1b7d5571a610316b7f31d95928331b86fd3f398b8fd48965`.
- `test/frozen-browser-consumed-report.test.ts`. `0ccc92775c07c454216522dcfb241ea9ddaf70d3c76123eb2c356b1b550e3ab1`.