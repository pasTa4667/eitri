import { afterEach, expect, test, vi } from 'vitest';
import * as Sentry from '@sentry/react';
import { initializeReporting, reportScenario, attributeScenario } from './scenario-reporting.js';

vi.mock('@sentry/react', () => ({ init: vi.fn(), captureException: vi.fn() }));
afterEach(() => {
  initializeReporting('validation', '');
  vi.clearAllMocks();
});
const ids = ['profile-name', 'cart-total', 'expected-validation', 'transient-upstream'];

test('scenario reporting is disabled in validation', () => {
  expect(initializeReporting('validation', 'https://synthetic.invalid')).toBe(false);
  reportScenario('expected-validation', new SyntaxError('invalid'));
  expect(Sentry.init).toHaveBeenCalledTimes(0);
  expect(Sentry.captureException).toHaveBeenCalledTimes(0);
});
test('scenario reporting is disabled without a DSN', () => {
  expect(initializeReporting('demo', '')).toBe(false);
  expect(initializeReporting(undefined, 'https://synthetic.invalid')).toBe(false);
  reportScenario('transient-upstream', new Error('unavailable'));
  expect(Sentry.init).toHaveBeenCalledTimes(0);
  expect(Sentry.captureException).toHaveBeenCalledTimes(0);
});
test('scenario reporting initializes demo with the fixed release', () => {
  expect(initializeReporting('demo', 'https://synthetic.invalid')).toBe(true);
  expect(Sentry.init).toHaveBeenCalledExactlyOnceWith({
    dsn: 'https://synthetic.invalid',
    environment: 'demo',
    release: 'eitri-fixture-scenarios-v1',
    sendDefaultPii: false,
  });
});
test('scenario reports carry stable tags and fingerprints', () => {
  initializeReporting('demo', 'https://synthetic.invalid');
  const error = new SyntaxError('invalid');
  for (const id of ids) {
    reportScenario(id, error);
    expect(Sentry.captureException).toHaveBeenLastCalledWith(error, {
      captureContext: {
        tags: { 'fixture.scenario': id },
        fingerprint: ['eitri-fixture-v1', id],
      },
      mechanism: { handled: true, type: 'fixture.handled' },
    });
  }
  expect(Sentry.captureException).toHaveBeenCalledTimes(4);
  expect(() => reportScenario('unknown', error)).toThrow('Unknown fixture scenario');
});
test('scenario boundary scope carries stable tags and fingerprints', () => {
  for (const id of ids) {
    const scope = { setTag: vi.fn(), setFingerprint: vi.fn() };
    attributeScenario(scope, id);
    expect(scope.setTag).toHaveBeenCalledExactlyOnceWith('fixture.scenario', id);
    expect(scope.setFingerprint).toHaveBeenCalledExactlyOnceWith(['eitri-fixture-v1', id]);
  }
});
