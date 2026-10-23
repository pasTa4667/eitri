import { expect, test } from 'vitest';
import { simulateUpstream } from './transient-upstream.js';

test('transient upstream returns unavailable on attempt one', () => {
  expect(simulateUpstream(1)).toEqual({
    kind: 'unavailable',
    message: 'Order service temporarily unavailable. Try again.',
  });
});
test('transient upstream returns Order 42 loaded. on attempt two', () => {
  expect(simulateUpstream(2)).toEqual({ kind: 'loaded', message: 'Order 42 loaded.' });
});
test('transient upstream remains loaded on attempt three', () => {
  expect(simulateUpstream(3)).toEqual({ kind: 'loaded', message: 'Order 42 loaded.' });
});
