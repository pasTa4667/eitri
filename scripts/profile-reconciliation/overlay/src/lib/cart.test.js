import { expect, test } from 'vitest';
import { getCartTotal } from './cart.js';

test('cart total returns 1250 for one amount', () => {
  expect(getCartTotal([1250])).toBe(1250);
});
test('cart total returns 2000 for three amounts', () => {
  expect(getCartTotal([1250, 500, 250])).toBe(2000);
});
test('cart total returns 0 for two zero amounts', () => {
  expect(getCartTotal([0, 0])).toBe(0);
});
