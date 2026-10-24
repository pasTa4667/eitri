import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  applicationVariant,
  admitApplicationResult,
} from '../scripts/profile-reconciliation/application.mjs';

import { applicationResult } from './fixture-application-check-fixture.mjs';

const installed = JSON.parse(
  await readFile(
    new URL('../scripts/profile-reconciliation/installed-inputs.json', import.meta.url),
  ),
);
const patches = {
  'fixture-profile-v1': {
    path: 'src/lib/errors.js',
    size: 536,
    sha256: '53b49f629b4d6eededda418a888a5f3004815adbf7bd003ed8e5729f0f76c791',
  },
  'fixture-cart-v1': {
    path: 'src/lib/cart.js',
    size: 105,
    sha256: 'db2e634f6e3a793dd93cd0f4460a8617f8bac18c843252b1e7eaddcfa99d16db',
  },
};
for (const [scenario, patch] of Object.entries(patches)) {
  test(`${scenario} selects only exact installed or reviewed scripted revisions`, () => {
    assert.equal(
      applicationVariant(scenario, installed),
      scenario === 'fixture-profile-v1'
        ? 'baseline-with-regressions'
        : 'cart-baseline-with-regressions',
    );
    const candidate = installed.map((item) => (item.path === patch.path ? patch : item));
    assert.equal(
      applicationVariant(scenario, candidate),
      scenario === 'fixture-profile-v1' ? 'scripted-candidate' : 'cart-scripted-candidate',
    );
    for (let i = 0; i < installed.length; i++) {
      const changed = structuredClone(candidate);
      changed[i].sha256 = '0'.repeat(64);
      assert.throws(() => applicationVariant(scenario, changed));
      assert.throws(() =>
        applicationVariant(
          scenario,
          candidate.filter((_, n) => n !== i),
        ),
      );
    }
    for (const path of ['.env', 'src/regression/forged.test.js', 'node_modules/forged.js'])
      assert.throws(() =>
        applicationVariant(scenario, [...candidate, { path, size: 1, sha256: '0'.repeat(64) }]),
      );
    assert.throws(() => applicationVariant(scenario, [...candidate, candidate[0]]));
    const other = Object.values(patches).find((item) => item.path !== patch.path);
    assert.throws(() =>
      applicationVariant(
        scenario,
        candidate.map((item) => (item.path === other.path ? other : item)),
      ),
    );
  });
}
for (const [scenario, patch] of Object.entries(patches))
  for (const fixed of [false, true]) {
    test(`${scenario} ${fixed ? 'green' : 'red'} requires complete protected observations`, () => {
      const manifest = installed.map((item) => (fixed && item.path === patch.path ? patch : item));
      const result = applicationResult(applicationVariant(scenario, manifest));
      const expected = {
        red: !fixed,
        unit: scenario === 'fixture-profile-v1' ? 35 : 32,
        browser: 9,
      };
      assert.deepEqual(admitApplicationResult(scenario, manifest, result), expected);
      for (const mutate of [
        (value) => {
          value.variant = 'baseline';
        },
        (value) => {
          value.verdict = 'blocked';
        },
        (value) => {
          value.previewStopped = false;
        },
        (value) => {
          value.error = 'unexpected';
        },
        (value) => {
          value.commands.pop();
        },
        (value) => {
          value.commands[1].exit = 1;
        },
        (value) => {
          value.commands[0].signal = 'SIGKILL';
        },
        (value) => {
          value.commands[0].args = ['test'];
        },
        (value) => {
          value.unit.testResults[0].assertionResults.pop();
        },
        (value) => {
          value.unit.testResults[0].assertionResults[0].status = 'pending';
        },
        (value) => {
          value.unitWitness.tests[0].retry = 1;
        },
        (value) => {
          value.unitWitness.unhandledErrors = ['unexpected'];
        },
        (value) => {
          value.browser.suites[0].specs[0].tests[0].expectedStatus = 'failed';
        },
        (value) => {
          value.browser.suites[0].specs[0].tests[0].results[0].retry = 1;
        },
        (value) => {
          value.browser.errors = ['unexpected'];
        },
        (value) => {
          value.expectedRedAssertions = ['invented'];
        },
        (value) => {
          value.builtBundle.proofPassed = false;
        },
        (value) => {
          value.builtBundle.manifest.digest = '0'.repeat(64);
        },
        (value) => {
          value.builtBundle.observed.pop();
        },
        (value) => {
          value.builtBundle.observed[0].sha256 = '0'.repeat(64);
        },
        (value) => {
          value.builtBundle.observed[1].status = 404;
        },
        (value) => {
          value.builtBundle.origin = 'http://remote.invalid';
        },
      ]) {
        const changed = structuredClone(result);
        mutate(changed);
        assert.throws(() => admitApplicationResult(scenario, manifest, changed));
      }
    });
  }
test('application selection rejects control, unknown and malformed scenarios', () => {
  for (const scenario of [
    'expected-validation',
    'transient-upstream',
    'profile-name-v1',
    null,
    {},
    '',
  ])
    assert.throws(() => applicationVariant(scenario, installed));
});
test('a claimed green application result is not evidence without complete observations', () => {
  for (const value of [
    null,
    {},
    { verdict: 'passed' },
    { variant: 'scripted-candidate', verdict: 'passed', previewStopped: true },
  ])
    assert.throws(() => admitApplicationResult('fixture-profile-v1', installed, value));
});
