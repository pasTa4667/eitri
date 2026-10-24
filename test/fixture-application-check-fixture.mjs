import { createHash } from 'node:crypto';
import { variantExpectation } from '../scripts/profile-reconciliation/scenarios.mjs';

export function applicationResult(variant) {
  const expected = variantExpectation(variant);
  const failed = (record) => expected.red && record.failure;
  const diagnostic = (record) => {
    switch (record.failure) {
      case 'profile-property-typeerror':
        return 'TypeError: Cannot read properties';
      case 'profile-react-fallback':
        return 'AssertionError: Hello, Anonymous';
      case 'cart-reduce-typeerror':
        return 'TypeError: Reduce of empty array with no initial value';
      case 'cart-react-zero':
        return 'AssertionError: Total: 0 cents, Reduce of empty array with no initial value';
      case 'profile-browser-fallback':
        return `expect(locator).toHaveText(expected)\nLocator: getByTestId('badge')\nExpected string: "Hello, Anonymous"`;
      case 'cart-browser-zero':
        return `expect(locator).toHaveText(expected)\nLocator: getByTestId('cart-total')\nExpected string: "Total: 0 cents"\nReceived string: "Reduce of empty array with no initial value"`;
      default:
        throw Error('Unexpected diagnostic');
    }
  };
  const files = [
    { path: 'index.html', size: 12, sha256: '1'.repeat(64) },
    { path: 'assets/index.js', size: 24, sha256: '2'.repeat(64) },
  ];
  return {
    variant,
    verdict: 'passed',
    previewStopped: true,
    commands: [
      {
        args: [
          'test',
          '--',
          '--retry=0',
          '--reporter=json',
          '--reporter=/opt/verify/unit-witness.mjs',
          '--outputFile=/tmp/unit.json',
        ],
        exit: expected.red ? 1 : 0,
        signal: null,
      },
      { args: ['run', 'build'], exit: 0, signal: null },
      {
        args: ['run', 'test:e2e', '--', '--config=verification.config.mjs', '--reporter=json'],
        exit: expected.red ? 1 : 0,
        signal: null,
      },
    ],
    expectedRedAssertions: [...expected.unit, ...expected.browser]
      .filter(failed)
      .map((record) => record.fullName),
    unit: {
      success: !expected.red,
      numPendingTestSuites: 0,
      numPendingTests: 0,
      numTodoTests: 0,
      numTotalTests: expected.unit.length,
      numFailedTests: expected.unit.filter(failed).length,
      numPassedTests: expected.unit.filter((record) => !failed(record)).length,
      testResults: [...new Set(expected.unit.map((record) => record.file))].map((file) => ({
        name: `/tmp/work/${file}`,
        message: '',
        status: expected.unit.some((record) => record.file === file && failed(record))
          ? 'failed'
          : 'passed',
        assertionResults: expected.unit
          .filter((record) => record.file === file)
          .map((record) => ({
            fullName: record.fullName,
            status: failed(record) ? 'failed' : 'passed',
            failureMessages: failed(record) ? [diagnostic(record)] : [],
          })),
      })),
    },
    unitWitness: {
      version: 1,
      reason: expected.red ? 'failed' : 'passed',
      unhandledErrors: [],
      moduleErrors: [],
      tests: expected.unit.map((record) => ({
        file: record.file,
        fullName: record.fullName,
        state: failed(record) ? 'failed' : 'passed',
        retryCount: 0,
        repeatCount: 0,
        retry: 0,
        repeats: 0,
        fails: false,
        mode: 'run',
      })),
    },
    browser: {
      errors: [],
      suites: [
        {
          specs: expected.browser.map((record) => ({
            title: record.fullName,
            file: record.file.replace(/^e2e\//, ''),
            tests: [
              {
                expectedStatus: 'passed',
                results: [
                  {
                    retry: 0,
                    status: failed(record) ? 'failed' : 'passed',
                    errors: failed(record) ? [{ message: diagnostic(record) }] : [],
                  },
                ],
              },
            ],
          })),
        },
      ],
    },
    builtBundle: {
      version: 1,
      server: 'vite-preview',
      origin: 'http://127.0.0.1:4173',
      proofPassed: true,
      manifest: {
        version: 1,
        files,
        digest: createHash('sha256').update(JSON.stringify(files)).digest('hex'),
      },
      observed: files.map((file, i) => ({
        ...file,
        status: 200,
        kind: i === 0 ? 'document' : 'javascript',
      })),
    },
  };
}
