import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cp,
  lstat,
  mkdir,
  opendir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { connect } from 'node:net';
import { stripVTControlCharacters } from 'node:util';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function inventoryFreshBuild() {
  const files = [];
  let entries = 0;
  let total = 0;
  const visit = async (path, depth) => {
    assert.ok(depth <= 8, 'Built output directory depth exceeded');
    const stat = await lstat(`/tmp/work/dist/${path}`);
    assert.ok(!stat.isSymbolicLink(), 'Built output symlink rejected');
    if (stat.isDirectory()) {
      for await (const entry of await opendir(`/tmp/work/dist/${path}`)) {
        assert.ok(++entries <= 256, 'Built output entry limit exceeded');
        assert.match(entry.name, /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/, 'Unsafe built output name');
        await visit(path ? `${path}/${entry.name}` : entry.name, depth + 1);
      }
    } else {
      assert.ok(
        stat.isFile() && stat.nlink === 1,
        'Built output must be a regular single-link file',
      );
      assert.ok(files.length < 128, 'Built output file limit exceeded');
      assert.ok(stat.size > 0 && stat.size <= 8 * 1024 ** 2, 'Built output file size exceeded');
      total += stat.size;
      assert.ok(total <= 32 * 1024 ** 2, 'Built output aggregate size exceeded');
      const bytes = await readFile(`/tmp/work/dist/${path}`);
      assert.equal(bytes.length, stat.size, 'Built output size changed');
      files.push({ path, size: bytes.length, sha256: sha256(bytes) });
    }
  };
  await visit('', 0);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  assert.ok(
    files.some((file) => file.path === 'index.html'),
    'Built index.html required',
  );
  assert.ok(
    files.some((file) => /^assets\/.+\.js$/.test(file.path)),
    'Compiled JavaScript required',
  );
  return { version: 1, files, digest: sha256(JSON.stringify(files)) };
}

async function readBuiltBundleEvidence(manifest) {
  const stat = await lstat('/tmp/built-proof.json');
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
  assert.ok(stat.size > 0 && stat.size <= 64 * 1024, 'Built proof size exceeded');
  const bytes = await readFile('/tmp/built-proof.json');
  assert.equal(bytes.length, stat.size);
  const proof = JSON.parse(bytes);
  assert.equal(proof.version, 1);
  assert.equal(proof.server, 'vite-preview');
  assert.equal(proof.origin, 'http://127.0.0.1:4173');
  assert.equal(proof.manifestDigest, manifest.digest);
  assert.equal(proof.proofPassed, true);
  assert.ok(Array.isArray(proof.observed) && proof.observed.length <= 128);
  const files = new Map(manifest.files.map((file) => [file.path, file]));
  let total = 0;
  for (const observed of proof.observed) {
    assert.ok(['document', 'javascript', 'stylesheet'].includes(observed.kind));
    assert.equal(observed.status, 200);
    assert.deepEqual(
      { path: observed.path, size: observed.size, sha256: observed.sha256 },
      files.get(observed.path),
      'Browser response differs from fresh build',
    );
    if (observed.kind === 'document') assert.equal(observed.path, 'index.html');
    if (observed.kind === 'javascript') assert.match(observed.path, /^assets\/.+\.js$/);
    if (observed.kind === 'stylesheet') assert.match(observed.path, /\.css$/);
    total += observed.size;
    assert.ok(total <= 32 * 1024 ** 2, 'Browser response aggregate size exceeded');
  }
  assert.equal(proof.observed.filter((response) => response.kind === 'document').length, 1);
  assert.ok(proof.observed.some((response) => response.kind === 'javascript'));
  return {
    version: 1,
    server: proof.server,
    origin: proof.origin,
    manifest,
    observed: proof.observed,
    proofPassed: true,
  };
}

async function assertPreviewStopped() {
  await new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port: 4173 });
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      reject(new Error('Preview remained listening after Playwright exit'));
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('Preview teardown check timed out'));
    });
    socket.once('error', (error) => {
      socket.destroy();
      if (error.code === 'ECONNREFUSED') resolve();
      else reject(error);
    });
  });
}

const normalUnitTitles = [
  'getUserDisplayName formats profile name "ada" as ada',
  'getUserDisplayName formats profile name "  Ada Lovelace  " as Ada Lovelace',
  'getUserDisplayName formats profile name "gRaCe Hopper" as gRaCe Hopper',
  'getUserDisplayName formats profile name " \\t " as Anonymous',
  'getUserDisplayName formats profile name undefined as Anonymous',
  'getUserDisplayName formats profile name null as Anonymous',
  'getUserDisplayName falls back for a missing name',
  'parseConfig parses valid JSON',
  'parseConfig throws a SyntaxError for invalid JSON',
  'fetchOrder returns the json body on success',
  'fetchOrder throws on a non-ok response',
  'App shows navigation to the three error pages',
  'App render error page initially shows the profile name',
  'App click error page throws from the handler',
];
const helperTitles = ['missing-profile', 'null-profile', 'null-user', 'undefined-user'].map(
  (id) => `profile fallback regression ${id} returns Anonymous`,
);
const callerTitle = 'profile caller regression renders Anonymous after clearing the user';
const proofTitle = 'built assets serve the rendered application';
const browserRegressionTitle = 'profile caller renders Anonymous after clearing the user';
const normalBrowserTitles = [
  'render error page initially shows the profile name',
  'click error page raises an uncaught error',
  'async error page raises an unhandled rejection',
  proofTitle,
];

const variant = process.argv[2];
assert.ok(['baseline', 'baseline-with-regressions', 'scripted-candidate'].includes(variant));
const red = variant === 'baseline-with-regressions';
const report = { variant, commands: [], verdict: 'blocked' };
try {
  assert.equal(process.getuid(), 1001);
  assert.equal(process.getgid(), 1001);
  await cp(`/opt/inputs/${variant}`, '/tmp/work', { recursive: true });
  await mkdir('/tmp/work/node_modules');
  for (const entry of await readdir('/home/pwuser/node_modules')) {
    await symlink(`/home/pwuser/node_modules/${entry}`, `/tmp/work/node_modules/${entry}`);
  }
  await cp('/opt/verify/playwright.config.mjs', '/tmp/work/verification.config.mjs');
  await cp('/opt/verify/built-assets.spec.js', '/tmp/work/e2e/built-assets.spec.js');
  const run = (args) => {
    const result = spawnSync('npm', args, {
      cwd: '/tmp/work',
      env: {
        ...process.env,
        HOME: '/tmp',
        CI: '1',
        VITE_SENTRY_DSN: '',
        PLAYWRIGHT_JSON_OUTPUT_NAME: '/tmp/browser.json',
        DEBUG: 'pw:browser',
      },
      encoding: 'utf8',
      timeout: 180000,
      maxBuffer: 8 * 1024 * 1024,
    });
    report.commands.push({
      args,
      exit: result.status,
      signal: result.signal,
      stdout: result.stdout,
      stderr: result.stderr,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return result.status;
  };
  const unitExit = run([
    'test',
    '--',
    '--retry=0',
    '--reporter=json',
    '--outputFile=/tmp/unit.json',
  ]);
  await rm('/tmp/work/dist', { recursive: true, force: true });
  assert.equal(run(['run', 'build']), 0, 'Vite build must pass before browser startup');
  const manifest = await inventoryFreshBuild();
  const manifestText = JSON.stringify(manifest);
  assert.ok(Buffer.byteLength(manifestText) <= 64 * 1024, 'Built manifest size exceeded');
  await writeFile('/tmp/built-manifest.json', manifestText, { flag: 'wx' });
  await rm('/tmp/built-proof.json', { force: true });
  const browserExit = run([
    'run',
    'test:e2e',
    '--',
    '--config=verification.config.mjs',
    '--reporter=json',
  ]);
  await assertPreviewStopped();
  report.previewStopped = true;
  report.unit = JSON.parse(await readFile('/tmp/unit.json', 'utf8'));
  report.browser = JSON.parse(await readFile('/tmp/browser.json', 'utf8'));
  const unitAssertions = report.unit.testResults.flatMap((result) => result.assertionResults);
  assert.deepEqual(
    unitAssertions.map((result) => result.fullName).sort(),
    (variant === 'baseline'
      ? normalUnitTitles
      : [...normalUnitTitles, ...helperTitles, callerTitle]
    ).sort(),
    'Exact unit title set required',
  );
  assert.equal(report.unit.numPendingTests, 0);
  assert.equal(report.unit.numTodoTests, 0);
  const specs = [];
  const visit = (suite, parents = []) => {
    for (const spec of suite.specs ?? [])
      specs.push({ ...spec, title: [...parents, spec.title].join(' ') });
    for (const child of suite.suites ?? []) visit(child, [...parents, child.title]);
  };
  for (const suite of report.browser.suites) visit(suite);
  assert.equal(report.browser.errors.length, 0);
  assert.deepEqual(
    specs.map((spec) => spec.title).sort(),
    (variant === 'baseline'
      ? normalBrowserTitles
      : [...normalBrowserTitles, browserRegressionTitle]
    ).sort(),
    'Exact browser title set required',
  );
  for (const spec of specs) {
    assert.equal(spec.tests.length, 1);
    const browserTest = spec.tests[0];
    assert.equal(browserTest.expectedStatus, 'passed');
    assert.equal(browserTest.results.length, 1);
    assert.equal(browserTest.results[0].retry, 0);
    assert.ok(['passed', 'failed'].includes(browserTest.results[0].status));
    if (browserTest.results[0].status === 'passed')
      assert.equal(browserTest.results[0].errors.length, 0);
  }
  assert.equal(
    specs.find((spec) => spec.title === proofTitle).tests[0].results[0].status,
    'passed',
  );
  report.builtBundle = await readBuiltBundleEvidence(manifest);
  const browserFailures = specs.filter((spec) => spec.tests[0].results[0].status === 'failed');
  const unitFailures = unitAssertions.filter((result) => result.status === 'failed');
  assert.ok(unitAssertions.every((result) => ['passed', 'failed'].includes(result.status)));
  for (const result of unitAssertions)
    if (result.status === 'passed') assert.equal(result.failureMessages.length, 0);
  if (red) {
    assert.equal(unitExit, 1);
    assert.equal(browserExit, 1);
    assert.deepEqual(
      unitFailures.map((result) => result.fullName).sort(),
      [...helperTitles, callerTitle].sort(),
    );
    for (const failure of unitFailures) {
      const text = failure.failureMessages.join('\n');
      assert.match(
        text,
        failure.fullName === callerTitle ? /Hello, Anonymous/ : /TypeError.*Cannot read properties/,
      );
    }
    assert.deepEqual(
      browserFailures.map((spec) => spec.title),
      ['profile caller renders Anonymous after clearing the user'],
    );
    const errors = browserFailures[0].tests[0].results[0].errors;
    assert.equal(errors.length, 1);
    const message = stripVTControlCharacters(errors[0].message);
    assert.match(message, /expect\(locator\)\.toHaveText\(expected\)/);
    assert.match(message, /getByTestId\('badge'\)/);
    assert.match(message, /Expected(?: string)?:\s*"Hello, Anonymous"/);
    report.expectedRedAssertions = [...helperTitles, callerTitle, browserFailures[0].title];
  } else {
    assert.equal(unitExit, 0);
    assert.equal(browserExit, 0);
    assert.equal(unitFailures.length, 0);
    assert.equal(browserFailures.length, 0);
  }
  assert.equal(unitAssertions.length, variant === 'baseline' ? 14 : 19);
  assert.doesNotMatch(report.commands[2].stderr, /--no-sandbox/);
  assert.match(report.commands[2].stderr, /<launching>/);
  report.verdict = 'passed';
} catch (error) {
  report.error = error.stack;
}
console.log(JSON.stringify(report));
if (report.verdict !== 'passed') process.exitCode = 1;
