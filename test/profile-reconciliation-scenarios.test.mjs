import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import {
  reportingMetadata,
  scenarios,
  variantExpectation,
} from '../scripts/profile-reconciliation/scenarios.mjs';

const recipe = new URL('../scripts/profile-reconciliation/', import.meta.url);

test('fixture contract selects only the five independent scenario variants', () => {
  for (const [id, target, revision, units, browsers, red] of [
    ['baseline', null, 'baseline', 30, 8, false],
    ['baseline-with-regressions', 'profile-name', 'baseline', 35, 9, true],
    ['scripted-candidate', 'profile-name', 'candidate', 35, 9, false],
    ['cart-baseline-with-regressions', 'cart-total', 'baseline', 32, 9, true],
    ['cart-scripted-candidate', 'cart-total', 'candidate', 32, 9, false],
  ]) {
    const expected = variantExpectation(id);
    assert.deepEqual(
      [
        expected.target,
        expected.revision,
        expected.unit.length,
        expected.browser.length,
        expected.red,
      ],
      [target, revision, units, browsers, red],
    );
    assert.equal(new Set(expected.unit.map((entry) => entry.fullName)).size, units);
    assert.equal(new Set(expected.browser.map((entry) => entry.fullName)).size, browsers);
    assert.equal(
      expected.unit.filter((entry) => entry.failure).length,
      target === 'profile-name' ? 5 : target === 'cart-total' ? 2 : 0,
    );
  }
  for (const invalid of [
    'expected-validation',
    'transient-upstream',
    'cart-total',
    'combined-candidate',
    '',
    undefined,
  ]) {
    assert.throws(() => variantExpectation(invalid), /Unknown fixture variant/);
  }
});

test('fixture reporting projection excludes outcome and admission policy', () => {
  const metadata = reportingMetadata();
  assert.deepEqual(metadata, {
    release: 'eitri-fixture-scenarios-v1',
    scenarios: ['profile-name', 'cart-total', 'expected-validation', 'transient-upstream'].map(
      (id) => ({
        id,
        route: id === 'profile-name' ? '/render-error' : `/${id}`,
        tags: { 'fixture.scenario': id },
        fingerprint: ['eitri-fixture-v1', id],
      }),
    ),
  });
  assert.deepEqual(
    scenarios.map((entry) => [entry.id, entry.kind]),
    [
      ['profile-name', 'latent'],
      ['cart-total', 'latent'],
      ['expected-validation', 'control'],
      ['transient-upstream', 'control'],
    ],
  );
});

test('fixture overlay and target regressions package every required added check', async () => {
  const baseline = variantExpectation('baseline');
  const files = [...new Set([...baseline.unit, ...baseline.browser].map((entry) => entry.file))];
  for (const path of files.filter(
    (path) =>
      ![
        'src/lib/errors.test.js',
        'src/App.test.jsx',
        'e2e/errors.spec.js',
        'e2e/built-assets.spec.js',
      ].includes(path),
  )) {
    const source = await readFile(new URL(`overlay/${path}`, recipe), 'utf8');
    for (const entry of [...baseline.unit, ...baseline.browser].filter(
      (entry) => entry.file === path,
    ))
      assert.ok(source.includes(`'${entry.fullName}'`), entry.fullName);
  }
  for (const target of ['profile-name', 'cart-total']) {
    const expected = variantExpectation(
      target === 'profile-name' ? 'scripted-candidate' : 'cart-scripted-candidate',
    );
    for (const entry of [...expected.unit, ...expected.browser].filter((entry) => entry.failure)) {
      const name = entry.file.split('/').at(-1);
      const bytes = await readFile(new URL(`regressions/${name}`, recipe));
      assert.ok(bytes.length > 0);
    }
  }
  const patch = await readFile(new URL('scenarios.patch', recipe));
  const parsed = spawnSync('git', ['apply', '--numstat', '-'], { input: patch, encoding: 'utf8' });
  assert.equal(parsed.status, 0, parsed.stderr);
  assert.deepEqual(
    parsed.stdout
      .trim()
      .split('\n')
      .map((line) => line.split('\t')[2]),
    ['src/App.jsx', 'src/instrument.js'],
  );
});

test('unit witness retains retry, repeat and expected-failure evidence omitted by pinned JSON', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'fixture-witness-'));
  try {
    const source = await readFile(new URL('unit-witness.mjs', recipe), 'utf8');
    const replacement = source.replace(
      "'/tmp/unit-witness.json'",
      JSON.stringify(join(root, 'result.json')),
    );
    const { default: UnitWitness } = await import(
      `data:text/javascript;base64,${Buffer.from(replacement).toString('base64')}`
    );
    const module = { type: 'module', relativeModuleId: 'src/sample.test.js', errors: () => [] };
    const suite = { type: 'suite', name: 'sample', parent: module, errors: () => [] };
    module.children = {
      allSuites: () => [suite],
      allTests: () => [
        {
          name: 'runs',
          parent: suite,
          options: { retry: { count: 2 }, repeats: 3, fails: true, mode: 'run' },
          result: () => ({ state: 'passed' }),
          diagnostic: () => ({ retryCount: 1, repeatCount: 3 }),
        },
      ],
    };
    await new UnitWitness().onTestRunEnd([module], [], 'passed');
    const report = JSON.parse(await readFile(join(root, 'result.json'), 'utf8'));
    assert.deepEqual(report, {
      version: 1,
      reason: 'passed',
      unhandledErrors: [],
      moduleErrors: [],
      tests: [
        {
          file: 'src/sample.test.js',
          fullName: 'sample runs',
          state: 'passed',
          retryCount: 1,
          repeatCount: 3,
          retry: 2,
          repeats: 3,
          fails: true,
          mode: 'run',
        },
      ],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
