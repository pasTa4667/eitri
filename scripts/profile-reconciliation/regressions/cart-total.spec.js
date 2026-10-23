import { expect, test } from '@playwright/test';

test('cart caller renders Total: 0 cents after emptying', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/cart-total');
  await expect(page.getByTestId('cart-total')).toHaveText('Total: 2000 cents');
  await page.getByRole('button', { name: 'Empty cart' }).click();
  await expect(page.getByTestId('cart-total')).toHaveText('Total: 0 cents');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
});
