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

const streamStatuses = Object.freeze([400, 401, 403, 404, 429]);

// Finite stream sub-stages: a failed automatic OAuth refresh before any request, an observed
// HTTP status class, or no response at all. Still not an error message or a root-cause claim.
export const nativeStreamFailureStages = Object.freeze([
  'stream-refresh',
  'stream-no-response',
  'stream-response-ok',
  ...streamStatuses.map((status) => `stream-http-${status}`),
  'stream-http-4xx',
  'stream-http-5xx',
  'stream-http-other',
]);

// Fixed local code locations, never an error message or a provider/auth diagnosis.
export const nativeFailureStages = Object.freeze([
  'bootstrap',
  'request-validation',
  'profile',
  'runtime',
  'model-selection',
  'stream',
  ...nativeStreamFailureStages,
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

// The pinned SDK raises this exact literal when its automatic token refresh fails during
// request setup; only that prefix is compared, and the provider text is never returned.
const refreshFailure = 'OAuth refresh failed for openai-codex';

export function nativeStreamFailureStage(errorMessage, status) {
  if (typeof errorMessage === 'string' && errorMessage.startsWith(refreshFailure))
    return 'stream-refresh';
  if (status === undefined) return 'stream-no-response';
  if (!Number.isSafeInteger(status)) return 'stream';
  if (status >= 200 && status < 300) return 'stream-response-ok';
  if (streamStatuses.includes(status)) return `stream-http-${status}`;
  if (status >= 400 && status < 500) return 'stream-http-4xx';
  if (status >= 500 && status < 600) return 'stream-http-5xx';
  return 'stream-http-other';
}

export function validateNativeDiagnostic(frame) {
  assert.deepEqual(Object.keys(frame), ['failureStage']);
  assert.ok(nativeFailureStages.includes(frame.failureStage));
  return frame.failureStage;
}
