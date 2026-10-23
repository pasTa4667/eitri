import assert from 'node:assert/strict';
import { stripVTControlCharacters } from 'node:util';

const legacyUnitTitles = [
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
const legacyBrowserTitles = [
  'render error page initially shows the profile name',
  'click error page raises an uncaught error',
  'async error page raises an unhandled rejection',
  proofTitle,
];

const check = (file, fullName, failure = null) => ({ file, fullName, failure });
const unit = (file, titles) => titles.map((title) => check(file, title));
const browser = (titles) => unit('e2e/scenarios.spec.js', titles);

export const release = 'eitri-fixture-scenarios-v1';
export const scenarios = [
  {
    id: 'profile-name',
    kind: 'latent',
    route: '/render-error',
    outcomes: { name: 'ada', fallback: 'Anonymous', greeting: 'Hello, Anonymous' },
    normalUnit: legacyUnitTitles
      .slice(0, 7)
      .map((title) => check('src/lib/errors.test.js', title))
      .concat(check('src/App.test.jsx', legacyUnitTitles[12])),
    normalBrowser: [check('e2e/errors.spec.js', legacyBrowserTitles[0])],
    regressionUnit: helperTitles
      .map((title) =>
        check('src/regression/profile-name.test.js', title, 'profile-property-typeerror'),
      )
      .concat(check('src/regression/profile-name.test.jsx', callerTitle, 'profile-react-fallback')),
    regressionBrowser: [
      check('e2e/profile-name.spec.js', browserRegressionTitle, 'profile-browser-fallback'),
    ],
  },
  {
    id: 'cart-total',
    kind: 'latent',
    route: '/cart-total',
    outcomes: { single: 1250, normal: 2000, zeros: 0, empty: 0 },
    normalUnit: unit('src/lib/cart.test.js', [
      'cart total returns 1250 for one amount',
      'cart total returns 2000 for three amounts',
      'cart total returns 0 for two zero amounts',
    ]).concat(check('src/scenarios.test.jsx', 'cart page initially renders Total: 2000 cents')),
    normalBrowser: browser(['cart page initially renders Total: 2000 cents']),
    regressionUnit: [
      check(
        'src/regression/cart-total.test.js',
        'cart total regression returns 0 for an empty cart',
        'cart-reduce-typeerror',
      ),
      check(
        'src/regression/cart-total.test.jsx',
        'cart caller regression renders Total: 0 cents after emptying',
        'cart-react-zero',
      ),
    ],
    regressionBrowser: [
      check(
        'e2e/cart-total.spec.js',
        'cart caller renders Total: 0 cents after emptying',
        'cart-browser-zero',
      ),
    ],
  },
  {
    id: 'expected-validation',
    kind: 'control',
    route: '/expected-validation',
    outcomes: { invalid: 'Enter valid JSON.', valid: 'Configuration accepted.' },
    normalUnit: unit('src/scenarios.test.jsx', [
      'expected validation accepts valid configuration without reporting',
      'expected validation reports invalid configuration and displays Enter valid JSON.',
    ]),
    normalBrowser: browser(['expected validation handles invalid configuration without a crash']),
  },
  {
    id: 'transient-upstream',
    kind: 'control',
    route: '/transient-upstream',
    outcomes: {
      unavailable: 'Order service temporarily unavailable. Try again.',
      loaded: 'Order 42 loaded.',
    },
    normalUnit: unit('src/lib/transient-upstream.test.js', [
      'transient upstream returns unavailable on attempt one',
      'transient upstream returns Order 42 loaded. on attempt two',
      'transient upstream remains loaded on attempt three',
    ]).concat(
      unit('src/scenarios.test.jsx', [
        'transient page reports once and succeeds on repeated presses',
        'transient page resets its sequence after remount',
      ]),
    ),
    normalBrowser: browser([
      'transient upstream fails once and succeeds on repeated presses',
      'transient upstream resets after reload and in a fresh context',
    ]),
  },
].map((scenario) => ({
  ...scenario,
  reporting: {
    tags: { 'fixture.scenario': scenario.id },
    fingerprint: ['eitri-fixture-v1', scenario.id],
  },
}));

export const variants = [
  { id: 'baseline', target: null, revision: 'baseline' },
  { id: 'baseline-with-regressions', target: 'profile-name', revision: 'baseline' },
  { id: 'scripted-candidate', target: 'profile-name', revision: 'candidate' },
  { id: 'cart-baseline-with-regressions', target: 'cart-total', revision: 'baseline' },
  { id: 'cart-scripted-candidate', target: 'cart-total', revision: 'candidate' },
];
const commonUnit = [
  ...legacyUnitTitles.slice(7, 11).map((title) => check('src/lib/errors.test.js', title)),
  ...[legacyUnitTitles[11], legacyUnitTitles[13]].map((title) => check('src/App.test.jsx', title)),
  ...unit('src/scenario-reporting.test.js', [
    'scenario reporting is disabled in validation',
    'scenario reporting is disabled without a DSN',
    'scenario reporting initializes demo with the fixed release',
    'scenario reports carry stable tags and fingerprints',
    'scenario boundary scope carries stable tags and fingerprints',
  ]),
];
const commonBrowser = legacyBrowserTitles
  .slice(1)
  .map((title) =>
    check(title === proofTitle ? 'e2e/built-assets.spec.js' : 'e2e/errors.spec.js', title),
  );

export function reportingMetadata() {
  return {
    release,
    scenarios: scenarios.map(({ id, route, reporting }) => ({ id, route, ...reporting })),
  };
}

export function variantExpectation(id) {
  const variant = variants.find((entry) => entry.id === id);
  assert.ok(variant, `Unknown fixture variant: ${id}`);
  const target =
    variant.target === null ? null : scenarios.find((entry) => entry.id === variant.target);
  assert.ok(
    variant.target === null || target?.kind === 'latent',
    'Unknown or non-latent fixture scenario',
  );
  const unit = [
    ...commonUnit,
    ...scenarios.flatMap((entry) => entry.normalUnit),
    ...(target?.regressionUnit ?? []),
  ];
  const browser = [
    ...commonBrowser,
    ...scenarios.flatMap((entry) => entry.normalBrowser),
    ...(target?.regressionBrowser ?? []),
  ];
  return { ...variant, unit, browser, red: target !== null && variant.revision === 'baseline' };
}

const titles = (records) => records.map((entry) => entry.fullName).sort();
const relative = (path) => path.replace(/^\/tmp\/work\//, '');
const reduceDiagnostic = /TypeError:?\s*Reduce of empty array with no initial value/;

function admitDiagnostic(kind, messages) {
  assert.equal(messages.length, 1, 'Exactly one target diagnostic required');
  const text = stripVTControlCharacters(messages[0]);
  if (kind === 'profile-property-typeerror')
    assert.match(text, /TypeError.*Cannot read properties/);
  else if (kind === 'profile-react-fallback') {
    assert.match(text, /AssertionError/);
    assert.match(text, /Hello, Anonymous/);
  } else if (kind === 'cart-reduce-typeerror') assert.match(text, reduceDiagnostic);
  else if (kind === 'cart-react-zero') {
    assert.match(text, /AssertionError/);
    assert.match(text, /Total: 0 cents/);
    assert.match(text, /Reduce of empty array with no initial value/);
  } else {
    assert.ok(['profile-browser-fallback', 'cart-browser-zero'].includes(kind));
    assert.match(text, /expect\(locator\)\.toHaveText\(expected\)/);
    if (kind === 'cart-browser-zero') {
      assert.match(text, /getByTestId\('cart-total'\)/);
      assert.match(text, /Expected(?: string)?:\s*"Total: 0 cents"/);
      assert.match(
        text,
        /Received(?: string)?:\s*"[^"\n]*Reduce of empty array with no initial value[^"\n]*"/,
      );
    } else {
      assert.match(text, /getByTestId\('badge'\)/);
      assert.match(text, /Expected(?: string)?:\s*"Hello, Anonymous"/);
    }
  }
}

export function admitVariantResults(expected, unitReport, browserReport, witness, exits) {
  assert.equal(exits.build, 0, 'Build must pass');
  assert.equal(exits.unit, expected.red ? 1 : 0);
  assert.equal(exits.browser, expected.red ? 1 : 0);
  assert.equal(unitReport.numPendingTests, 0);
  assert.equal(unitReport.numTodoTests, 0);
  assert.deepEqual(
    unitReport.testResults.map((file) => relative(file.name)).sort(),
    [...new Set(expected.unit.map((entry) => entry.file))].sort(),
    'Exact unit file set required',
  );
  const assertions = unitReport.testResults.flatMap((file) => {
    assert.equal(
      file.status,
      expected.red &&
        expected.unit.some((entry) => entry.file === relative(file.name) && entry.failure)
        ? 'failed'
        : 'passed',
    );
    assert.equal(file.message, '', 'Unit file errors rejected');
    return file.assertionResults.map((assertion) => ({ ...assertion, file: relative(file.name) }));
  });
  assert.deepEqual(titles(assertions), titles(expected.unit), 'Exact unit title set required');
  assert.equal(unitReport.success, !expected.red);
  assert.equal(unitReport.numPendingTestSuites, 0);
  assert.equal(unitReport.numTotalTests, assertions.length);
  assert.equal(
    unitReport.numFailedTests,
    expected.red ? expected.unit.filter((entry) => entry.failure).length : 0,
  );
  assert.equal(unitReport.numPassedTests, assertions.length - unitReport.numFailedTests);
  assert.equal(witness.version, 1);
  assert.equal(witness.reason, expected.red ? 'failed' : 'passed');
  assert.deepEqual(witness.unhandledErrors, []);
  assert.deepEqual(witness.moduleErrors, []);
  assert.deepEqual(titles(witness.tests), titles(expected.unit), 'Exact unit witness set required');
  for (const test of witness.tests) {
    const record = expected.unit.find((entry) => entry.fullName === test.fullName);
    assert.equal(test.file, record.file);
    assert.equal(test.retryCount, 0);
    assert.equal(test.repeatCount, 0);
    assert.equal(test.retry, 0);
    assert.equal(test.repeats, 0);
    assert.equal(test.fails, false);
    assert.equal(test.mode, 'run');
    assert.equal(test.state, expected.red && record.failure ? 'failed' : 'passed');
  }
  const specs = [];
  const visit = (suite, parents = [], file) => {
    for (const spec of suite.specs ?? [])
      specs.push({
        ...spec,
        file: `e2e/${spec.file ?? file}`,
        fullName: [...parents, spec.title].join(' '),
      });
    for (const child of suite.suites ?? [])
      visit(child, [...parents, child.title], child.file ?? file);
  };
  for (const suite of browserReport.suites) visit(suite, [], suite.file);
  assert.deepEqual(browserReport.errors, []);
  assert.deepEqual(titles(specs), titles(expected.browser), 'Exact browser title set required');
  const failures = [];
  for (const [results, records, isBrowser] of [
    [assertions, expected.unit, false],
    [specs, expected.browser, true],
  ]) {
    for (const result of results) {
      const record = records.find((entry) => entry.fullName === result.fullName);
      assert.equal(result.file, record.file);
      let status = result.status;
      let messages = result.failureMessages;
      if (isBrowser) {
        assert.equal(result.tests.length, 1);
        const test = result.tests[0];
        assert.equal(test.expectedStatus, 'passed');
        assert.ok(
          !(test.annotations ?? []).some((annotation) =>
            ['fail', 'skip', 'fixme'].includes(annotation.type),
          ),
          'Expected-failure annotations rejected',
        );
        assert.equal(test.results.length, 1);
        assert.equal(test.results[0].retry, 0);
        status = test.results[0].status;
        messages = test.results[0].errors.map((error) => error.message);
      }
      const failed = expected.red && record.failure !== null;
      assert.equal(status, failed ? 'failed' : 'passed', `Unexpected status: ${record.fullName}`);
      if (failed) {
        admitDiagnostic(record.failure, messages);
        failures.push(record.fullName);
      } else assert.deepEqual(messages, [], 'Errors on passing result rejected');
    }
  }
  return { verdict: 'passed', expectedRedAssertions: failures };
}
