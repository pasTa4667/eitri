import assert from 'node:assert/strict';
import { mkdtemp, realpath, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { FrozenBrowserValidator } = await import(
  pathToFileURL(resolve(process.argv[2], 'src/frozen-browser.ts')).href
);
const workspace = new Proxy(
  {},
  {
    get() {
      throw Error('unexpected-workspace-read');
    },
  },
);
const results = [];
for (const scenario of ['mutated-mode', 'unknown-mode']) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'eitri-journal-mode-')));
  let handle;
  try {
    const options = {
      directory,
      workspace,
      mode: scenario === 'unknown-mode' ? 'journal-onyl' : 'journal-only',
    };
    const opening = FrozenBrowserValidator.open(options);
    if (scenario === 'mutated-mode') options.mode = undefined;
    let error;
    try {
      handle = await opening;
    } catch (caught) {
      error = caught.code ?? caught.message;
    }
    results.push({
      scenario,
      error: error ?? null,
      exposedExecution: typeof handle?.validate === 'function',
      files: await readdir(directory),
    });
  } finally {
    await handle?.close();
    await rm(directory, { recursive: true });
  }
}
console.log(JSON.stringify(results, null, 2));
for (const result of results) {
  assert.equal(result.exposedExecution, false, `${result.scenario} must not expose execution`);
  assert.deepEqual(result.files, [], `${result.scenario} must not initialize an empty journal`);
  assert.notEqual(result.error, null);
}
