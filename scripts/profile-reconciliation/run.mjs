import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, symlink } from 'node:fs/promises';

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
  const unitExit = run(['test', '--', '--reporter=json', '--outputFile=/tmp/unit.json']);
  const buildExit = run(['run', 'build']);
  const browserExit = run([
    'run',
    'test:e2e',
    '--',
    '--config=verification.config.mjs',
    '--reporter=json',
  ]);
  report.unit = JSON.parse(await readFile('/tmp/unit.json', 'utf8'));
  report.browser = JSON.parse(await readFile('/tmp/browser.json', 'utf8'));
  assert.equal(buildExit, 0, 'Vite build must pass for every variant');
  const unitAssertions = report.unit.testResults.flatMap((result) => result.assertionResults);
  assert.ok(unitAssertions.length >= 14, 'Normal unit tests must be discovered');
  assert.equal(report.unit.numPendingTests, 0);
  assert.equal(report.unit.numTodoTests, 0);
  const specs = [];
  const visit = (suite) => {
    specs.push(...(suite.specs ?? []));
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of report.browser.suites) visit(suite);
  assert.equal(report.browser.errors.length, 0);
  assert.equal(specs.length, variant === 'baseline' ? 3 : 4);
  for (const spec of specs) {
    assert.equal(spec.tests.length, 1);
    assert.equal(spec.tests[0].results.length, 1);
    assert.ok(['passed', 'failed'].includes(spec.tests[0].results[0].status));
  }
  const browserFailures = specs.filter((spec) => spec.tests[0].results[0].status === 'failed');
  const unitFailures = unitAssertions.filter((result) => result.status === 'failed');
  assert.ok(unitAssertions.every((result) => ['passed', 'failed'].includes(result.status)));
  if (red) {
    assert.equal(unitExit, 1);
    assert.equal(browserExit, 1);
    const helperTitles = ['missing-profile', 'null-profile', 'null-user', 'undefined-user'].map(
      (id) => `profile fallback regression ${id} returns Anonymous`,
    );
    const callerTitle = 'profile caller regression renders Anonymous after clearing the user';
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
    assert.match(JSON.stringify(browserFailures[0].tests[0].results[0].errors), /Hello, Anonymous/);
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
