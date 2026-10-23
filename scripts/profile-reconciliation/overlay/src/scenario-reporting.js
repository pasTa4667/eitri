import * as Sentry from '@sentry/react';
import metadata from './scenario-metadata.js';

let enabled = false;

export function initializeReporting(environment, dsn) {
  enabled = environment === 'demo' && typeof dsn === 'string' && dsn.length > 0;
  if (!enabled) return false;
  Sentry.init({ dsn, environment: 'demo', release: metadata.release, sendDefaultPii: false });
  return true;
}

function descriptor(id) {
  const scenario = metadata.scenarios.find((scenario) => scenario.id === id);
  if (!scenario) throw new Error('Unknown fixture scenario');
  return scenario;
}

export function reportScenario(id, error) {
  const { tags, fingerprint } = descriptor(id);
  if (enabled)
    Sentry.captureException(error, {
      captureContext: { tags, fingerprint },
      mechanism: { handled: true, type: 'fixture.handled' },
    });
}

export function attributeScenario(scope, id) {
  const { tags, fingerprint } = descriptor(id);
  scope.setTag('fixture.scenario', tags['fixture.scenario']);
  scope.setFingerprint(fingerprint);
}
