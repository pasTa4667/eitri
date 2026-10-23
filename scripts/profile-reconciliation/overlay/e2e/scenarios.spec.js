import { expect, test } from '@playwright/test';

async function observe(page) {
  const errors = [];
  const requests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4173' || url.pathname.startsWith('/api/')) {
      requests.push(url.href);
      return route.abort();
    }
    return route.continue();
  });
  return () => {
    expect(errors).toEqual([]);
    expect(requests).toEqual([]);
  };
}
async function load(page, message, role) {
  await page.getByRole('button', { name: 'Load order' }).click();
  await expect(page.getByRole(role)).toHaveText(message);
}
async function sequence(page) {
  await load(page, 'Order service temporarily unavailable. Try again.', 'alert');
  await load(page, 'Order 42 loaded.', 'status');
  await expect(page.getByRole('alert')).toHaveCount(0);
}

test('cart page initially renders Total: 2000 cents', async ({ page }) => {
  const verify = await observe(page);
  await page.goto('/cart-total');
  await expect(page.getByTestId('cart-total')).toHaveText('Total: 2000 cents');
  verify();
});
test('expected validation handles invalid configuration without a crash', async ({ page }) => {
  const verify = await observe(page);
  await page.goto('/expected-validation');
  await page.getByRole('button', { name: 'Validate configuration' }).click();
  await expect(page.getByRole('status')).toHaveText('Configuration accepted.');
  await page.getByRole('textbox', { name: 'Configuration' }).fill('invalid');
  await page.getByRole('button', { name: 'Validate configuration' }).click();
  await expect(page.getByRole('alert')).toHaveText('Enter valid JSON.');
  await page.getByRole('textbox', { name: 'Configuration' }).fill('{}');
  await page.getByRole('button', { name: 'Validate configuration' }).click();
  await expect(page.getByRole('status')).toHaveText('Configuration accepted.');
  await expect(page.getByRole('alert')).toHaveCount(0);
  verify();
});
test('transient upstream fails once and succeeds on repeated presses', async ({ page }) => {
  const verify = await observe(page);
  await page.goto('/transient-upstream');
  await sequence(page);
  await load(page, 'Order 42 loaded.', 'status');
  verify();
});
test('transient upstream resets after reload and in a fresh context', async ({ page, browser }) => {
  const verify = await observe(page);
  await page.goto('/transient-upstream');
  await sequence(page);
  await page.reload();
  await sequence(page);
  verify();
  const context = await browser.newContext({
    serviceWorkers: 'block',
    baseURL: 'http://127.0.0.1:4173',
  });
  try {
    const fresh = await context.newPage();
    const verifyFresh = await observe(fresh);
    await fresh.goto('/transient-upstream');
    await sequence(fresh);
    verifyFresh();
  } finally {
    await context.close();
  }
});
