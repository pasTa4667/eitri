import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const checkout = await realpath(process.argv[2]);
const revision = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
execFileSync('git', ['-C', checkout, 'diff', '--exit-code', 'HEAD', '--', 'src', 'test', 'worker']);
console.log(`Protected retention target ${revision} at ${checkout}`);
const sourcePath = join(checkout, 'test/integration/frozen-browser.test.ts');
const source = await readFile(sourcePath, 'utf8');
const relocated = source.replace(
  /(from\s+['"])(\.\.?\/[^'"]+)(['"])/g,
  (_, before, specifier, after) =>
    `${before}${pathToFileURL(resolve(dirname(sourcePath), specifier)).href}${after}`,
);
const scratch = join(checkout, '.audit');
await mkdir(scratch, { recursive: true, mode: 0o700 });
const name = `harness-retention-${randomUUID()}`;
const testPath = join(scratch, `${name}.test.ts`);
const runnerPath = join(scratch, `${name}.mjs`);
await writeFile(
  testPath,
  relocated.replaceAll('../../src/', '../src/').replace('    f.retainState();', ''),
  { mode: 0o600 },
);
await writeFile(
  runnerPath,
  `import fs from 'node:fs/promises';
import { basename } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
const mkdtemp = fs.mkdtemp;
const rm = fs.rm;
fs.mkdtemp = async (...args) => {
  const root = await mkdtemp(...args);
  if (basename(root).startsWith('eitri-frozen-docker-')) {
    console.log('RETENTION_ROOT=' + JSON.stringify(await fs.realpath(root)));
  }
  return root;
};
fs.rm = async (path, options) => {
  if (basename(String(path)).startsWith('eitri-frozen-docker-')) {
    throw new Error('fixture must retain ownership accounting without an opt-in call');
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
  ['--test', '--test-name-pattern=actual Docker lost build client', runnerPath],
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
const timer = setTimeout(() => child.kill('SIGKILL'), 100000);
try {
  const status = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  assert.equal(
    status,
    0,
    'protected lost-build test must pass without attempting fixture deletion',
  );
  const roots = [...output.matchAll(/^RETENTION_ROOT=(.+)$/gm)].map((m) => JSON.parse(m[1]));
  assert.equal(roots.length, 1);
  const directory = join(roots[0], 'validator');
  const marker = JSON.parse(await readFile(join(directory, 'owner.json'), 'utf8'));
  const db = new DatabaseSync(join(directory, 'journal.sqlite'), { readOnly: true });
  try {
    const rows = db.prepare('SELECT body FROM runs').all();
    assert.equal(rows.length, 1);
    const run = JSON.parse(String(rows[0].body));
    assert.equal(run.intent.owner, marker.owner);
    assert.equal(run.ledger.build, 'unknown');
    assert.deepEqual(run.result.report.outcome, {
      kind: 'uncertain',
      code: 'daemon-build-unresolved',
    });
    assert.deepEqual(run.result.report.cleanup, {
      kind: 'incomplete',
      cache: 'retained',
      code: 'daemon-build-unresolved',
    });
  } finally {
    db.close();
  }
  console.log(`Verified retained unresolved ownership accounting at ${directory}`);
  console.log(`Protected instrument retained at ${runnerPath}`);
} finally {
  clearTimeout(timer);
}
