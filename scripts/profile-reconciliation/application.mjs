import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import inventory from './installed-inputs.json' with { type: 'json' };
import { admitVariantResults, variantExpectation } from './scenarios.mjs';

const inputs = structuredClone(inventory);
const patches = {
  'fixture-profile-v1': {
    baseline: 'baseline-with-regressions',
    candidate: 'scripted-candidate',
    file: {
      path: 'src/lib/errors.js',
      size: 536,
      sha256: '53b49f629b4d6eededda418a888a5f3004815adbf7bd003ed8e5729f0f76c791',
    },
  },
  'fixture-cart-v1': {
    baseline: 'cart-baseline-with-regressions',
    candidate: 'cart-scripted-candidate',
    file: {
      path: 'src/lib/cart.js',
      size: 105,
      sha256: 'db2e634f6e3a793dd93cd0f4460a8617f8bac18c843252b1e7eaddcfa99d16db',
    },
  },
};
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// This pilot admits reviewed scripted bytes, not arbitrary generated Node code.
export function applicationVariant(scenarioId, manifest) {
  assert.ok(typeof scenarioId === 'string' && Object.hasOwn(patches, scenarioId));
  const patch = patches[scenarioId];
  assert.ok(Array.isArray(manifest) && manifest.length === inputs.length);
  assert.equal(new Set(manifest.map((file) => file.path)).size, inputs.length);
  let fixed = false;
  for (const expected of inputs) {
    const actual = manifest.find((file) => file.path === expected.path);
    if (expected.path === patch.file.path && actual?.sha256 === patch.file.sha256) {
      assert.deepEqual(actual, patch.file);
      fixed = true;
    } else assert.deepEqual(actual, expected);
  }
  return fixed ? patch.candidate : patch.baseline;
}

export function admitApplicationResult(scenarioId, manifest, result) {
  const variant = applicationVariant(scenarioId, manifest);
  const expected = variantExpectation(variant);
  assert.equal(result.variant, variant);
  assert.equal(result.verdict, 'passed');
  assert.equal(result.previewStopped, true);
  assert.equal(Object.hasOwn(result, 'error'), false);
  assert.equal(result.commands.length, 3);
  assert.deepEqual(
    result.commands.map((command) => command.args),
    [
      [
        'test',
        '--',
        '--retry=0',
        '--reporter=json',
        '--reporter=/opt/verify/unit-witness.mjs',
        '--outputFile=/tmp/unit.json',
      ],
      ['run', 'build'],
      ['run', 'test:e2e', '--', '--config=verification.config.mjs', '--reporter=json'],
    ],
  );
  for (const command of result.commands) {
    assert.equal(command.signal, null);
    assert.equal(Object.hasOwn(command, 'error'), false);
  }
  const observation = admitVariantResults(
    expected,
    result.unit,
    result.browser,
    result.unitWitness,
    {
      unit: result.commands[0].exit,
      build: result.commands[1].exit,
      browser: result.commands[2].exit,
    },
  );
  assert.deepEqual(result.expectedRedAssertions, observation.expectedRedAssertions);
  const built = result.builtBundle;
  assert.equal(built.version, 1);
  assert.equal(built.server, 'vite-preview');
  assert.equal(built.origin, 'http://127.0.0.1:4173');
  assert.equal(built.proofPassed, true);
  assert.equal(built.manifest.version, 1);
  assert.ok(Array.isArray(built.manifest.files) && built.manifest.files.length <= 128);
  assert.equal(built.manifest.digest, sha256(JSON.stringify(built.manifest.files)));
  const paths = new Set();
  let size = 0;
  for (const file of built.manifest.files) {
    assert.match(file.path, /^(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*$/);
    assert.ok(!paths.has(file.path));
    paths.add(file.path);
    assert.ok(Number.isSafeInteger(file.size) && file.size > 0 && file.size <= 8 * 1024 ** 2);
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    size += file.size;
    assert.ok(size <= 32 * 1024 ** 2);
  }
  assert.ok(Array.isArray(built.observed) && built.observed.length <= 128);
  size = 0;
  for (const file of built.observed) {
    assert.ok(['document', 'javascript', 'stylesheet'].includes(file.kind));
    assert.equal(file.status, 200);
    assert.deepEqual(
      { path: file.path, size: file.size, sha256: file.sha256 },
      built.manifest.files.find((entry) => entry.path === file.path),
    );
    if (file.kind === 'document') assert.equal(file.path, 'index.html');
    if (file.kind === 'javascript') assert.match(file.path, /^assets\/.+\.js$/);
    if (file.kind === 'stylesheet') assert.match(file.path, /\.css$/);
    size += file.size;
    assert.ok(size <= 32 * 1024 ** 2);
  }
  assert.equal(built.observed.filter((file) => file.kind === 'document').length, 1);
  assert.ok(built.observed.some((file) => file.kind === 'javascript'));
  return { red: expected.red, unit: expected.unit.length, browser: expected.browser.length };
}
