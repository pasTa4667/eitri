import { expect, test } from '@playwright/test'

test('profile caller renders Anonymous after clearing the user', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/render-error')
  await expect(page.getByTestId('badge')).toHaveText('Hello, ada')
  await page.getByRole('button', { name: 'Trigger render error' }).click()
  await expect(page.getByTestId('badge')).toHaveText('Hello, Anonymous')
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(errors).toEqual([])
})
