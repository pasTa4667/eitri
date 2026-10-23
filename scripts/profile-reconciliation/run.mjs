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
import { admitVariantResults, variantExpectation } from './scenarios.mjs';

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

const variant = process.argv[2];
const expected = variantExpectation(variant);
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
        VITE_FIXTURE_ENV: 'validation',
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
    '--reporter=/opt/verify/unit-witness.mjs',
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
  const readReport = async (path) => {
    const stat = await lstat(path);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
    assert.ok(stat.size > 0 && stat.size <= 4 * 1024 ** 2, 'Result report size exceeded');
    const bytes = await readFile(path);
    assert.equal(bytes.length, stat.size);
    return JSON.parse(bytes);
  };
  const unit = await readReport('/tmp/unit.json');
  const browser = await readReport('/tmp/browser.json');
  const witness = await readReport('/tmp/unit-witness.json');
  report.unit = unit;
  report.browser = browser;
  report.unitWitness = witness;
  const observation = admitVariantResults(expected, unit, browser, witness, {
    unit: unitExit,
    build: 0,
    browser: browserExit,
  });
  report.expectedRedAssertions = observation.expectedRedAssertions;
  report.builtBundle = await readBuiltBundleEvidence(manifest);
  assert.doesNotMatch(report.commands[2].stderr, /--no-sandbox/);
  assert.match(report.commands[2].stderr, /<launching>/);
  report.verdict = 'passed';
} catch (error) {
  report.error = error.stack;
}
console.log(JSON.stringify(report));
if (report.verdict !== 'passed') process.exitCode = 1;
