import { expect, test } from 'vitest';
import { getCartTotal } from '../lib/cart.js';

test('cart total regression returns 0 for an empty cart', () => {
  expect(getCartTotal([])).toBe(0);
});
