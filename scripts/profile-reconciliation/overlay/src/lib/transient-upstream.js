export function simulateUpstream(attempt) {
  return attempt === 1
    ? { kind: 'unavailable', message: 'Order service temporarily unavailable. Try again.' }
    : { kind: 'loaded', message: 'Order 42 loaded.' };
}
