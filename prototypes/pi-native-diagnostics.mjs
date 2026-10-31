import assert from 'node:assert/strict';

// Fixed local code locations, never an error message or a provider/auth diagnosis.
export const nativeFailureStages = Object.freeze([
  'bootstrap',
  'request-validation',
  'profile',
  'runtime',
  'model-selection',
  'stream',
  'event-validation',
  'result-validation',
  'terminal-validation',
  'profile-release',
  'transport',
  'cleanup',
]);

export function validateNativeDiagnostic(frame) {
  assert.deepEqual(Object.keys(frame), ['failureStage']);
  assert.ok(nativeFailureStages.includes(frame.failureStage));
  return frame.failureStage;
}
