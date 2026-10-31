import assert from 'node:assert/strict';

const eventTypes = Object.freeze([
  'start',
  'text_start',
  'text_delta',
  'text_end',
  'thinking_start',
  'thinking_delta',
  'thinking_end',
  'toolcall_start',
  'toolcall_delta',
  'toolcall_end',
  'done',
]);

// Fixed local code locations, never an error message or a provider/auth diagnosis.
export const nativeFailureStages = Object.freeze([
  'bootstrap',
  'request-validation',
  'profile',
  'runtime',
  'model-selection',
  'stream',
  'event-validation',
  'event-alias',
  ...eventTypes.map((type) => `event-validation-${type}`),
  'result-validation',
  'terminal-validation',
  'profile-release',
  'transport',
  'cleanup',
]);

// Unknown/private event types stay generic: no provider-controlled string is echoed.
export function nativeEventFailureStage(type) {
  return eventTypes.includes(type) ? `event-validation-${type}` : 'event-validation';
}

export function validateNativeDiagnostic(frame) {
  assert.deepEqual(Object.keys(frame), ['failureStage']);
  assert.ok(nativeFailureStages.includes(frame.failureStage));
  return frame.failureStage;
}
