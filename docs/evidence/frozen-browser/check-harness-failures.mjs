import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const checkout = await realpath(process.argv[2]);
const mode = process.argv[3];
assert.ok(['dependent', 'created-only'].includes(mode));
const sourcePath = join(checkout, 'test/integration/frozen-browser.test.ts');
let source = await readFile(sourcePath, 'utf8');
function replace(before, after) {
  assert.equal(source.split(before).length, 2, `unique injection point required: ${before}`);
  source = source.replace(before, after);
}
if (mode === 'dependent') {
  replace(
    "      'intent',\n      'before-outcome-commit',\n      'after-outcome-commit',\n      'before-acknowledgment',",
    "      'after-outcome-commit',",
  );
  replace(
    '          removeDependent = container.remove;',
    "          removeDependent = container.remove;\n          throw new Error('injected-dependent-assertion');",
  );
} else {
  replace('const deadline = Date.now() + 50000;', 'const deadline = Date.now() + 8000;');
  replace(
    "if (state[0].State.Status === 'running') {",
    "if (state[0].State.Status === 'created-only-injected') {",
  );
}
source = source.replace(
  /(from\s+['"])(\.\.?\/[^'"]+)(['"])/g,
  (_, before, specifier, after) =>
    `${before}${pathToFileURL(resolve(dirname(sourcePath), specifier)).href}${after}`,
);
source = source.replaceAll('../../src/', '../src/');
const scratch = join(checkout, '.audit');
await mkdir(scratch, { recursive: true, mode: 0o700 });
const name = `harness-${mode}-${randomUUID()}`;
await writeFile(join(scratch, `${name}.test.ts`), source, { mode: 0o600 });
const runner = join(scratch, `${name}.mjs`);
await writeFile(
  runner,
  `import fs from 'node:fs/promises';
import { basename } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
const mkdtemp = fs.mkdtemp;
const rm = fs.rm;
fs.mkdtemp = async (...args) => {
  const root = await mkdtemp(...args);
  if (basename(root).startsWith('eitri-frozen-docker-')) {
    console.log('FAILURE_ROOT=' + JSON.stringify(await fs.realpath(root)));
  }
  return root;
};
fs.rm = async (path, options) => {
  if (basename(String(path)).startsWith('eitri-frozen-docker-')) {
    throw new Error('fixture must retain ownership accounting');
  }
  return rm(path, options);
};
syncBuiltinESMExports();
await import(${JSON.stringify(`./${name}.test.ts`)});
`,
  { mode: 0o600 },
);
const child = spawn(
  process.execPath,
  [
    '--test',
    `--test-name-pattern=actual Docker ${mode === 'dependent' ? 'crash boundaries' : 'cancellation'}`,
    runner,
  ],
  {
    cwd: checkout,
    env: { ...process.env, EITRI_FROZEN_DOCKER_ACCEPTANCE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let output = '';
for (const stream of [child.stdout, child.stderr]) {
  stream.on('data', (bytes) => {
    output += bytes;
    process.stdout.write(bytes);
  });
}
const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
try {
  const status = await new Promise((done, reject) => {
    child.once('error', reject);
    child.once('close', done);
  });
  assert.equal(status, 1, 'injected precondition failure must fail the child test');
  assert.match(
    output,
    mode === 'dependent'
      ? /injected-dependent-assertion/
      : /owned container was not observed running before cancellation/,
  );
  assert.doesNotMatch(output, /Error: fixture must retain ownership accounting/);
  const roots = [...output.matchAll(/^FAILURE_ROOT=(.+)$/gm)].map((m) => JSON.parse(m[1]));
  assert.equal(roots.length, 1);
  const root = roots[0];
  const directory = join(root, 'validator');
  await readFile(join(directory, 'owner.json'));
  const auxiliary = output.match(
    /Auxiliary container (eitri-frozen-(?:dependent|sentinel)-[a-f0-9-]+)/,
  )?.[1];
  assert.ok(auxiliary);
  const { execFileSync } = await import('node:child_process');
  const docker = (args) =>
    execFileSync('docker', ['--context', 'orbstack', ...args], {
      encoding: 'utf8',
      timeout: 15000,
    });
  assert.equal(
    docker(['container', 'ls', '--all', '--quiet', '--filter', `name=^/${auxiliary}$`]),
    '',
  );
  const db = new DatabaseSync(join(directory, 'journal.sqlite'), { readOnly: true });
  let run;
  try {
    run = JSON.parse(String(db.prepare('SELECT body FROM runs').get().body));
  } finally {
    db.close();
  }
  const { WorkspaceStore, virtualPath } = await import(
    pathToFileURL(join(checkout, 'src/workspace.ts'))
  );
  const { FrozenBrowserValidator } = await import(
    pathToFileURL(join(checkout, 'src/frozen-browser.ts'))
  );
  const store = await WorkspaceStore.open({
    directory: join(root, 'workspace'),
    regressionDirectory: virtualPath('test/regression'),
  });
  try {
    const validator = await FrozenBrowserValidator.open({ workspace: store, directory });
    try {
      const report = await validator.validate(run.intent.request, new AbortController().signal);
      assert.equal(report.outcome.kind, mode === 'dependent' ? 'baseline-reproduced' : 'cancelled');
      assert.equal(report.cleanup.kind, 'owned-removed');
      console.log(`Verified ${mode} failure retains accounting and removes only owned resources.`);
      console.log(
        `Recovered report ${JSON.stringify({ outcome: report.outcome, cleanup: report.cleanup })}`,
      );
      console.log(`Retained fixture ${root}`);
    } finally {
      await validator.close();
    }
  } finally {
    await store.close();
  }
} finally {
  clearTimeout(timer);
}
