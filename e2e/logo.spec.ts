import { expect, test } from '@playwright/test';
import { failOnErrors, login } from './helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('logo du loueur : importé une fois, visible dans Yoon Fleet et sur le contrat', async ({ page }) => {
  const check = failOnErrors(page);
  await login(page, 'admin');
  await page.goto('/parametres');
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'Logo', exact: true }) });
  await card.locator('input[type=file]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
  await expect(card.getByRole('img', { name: /Logo de/ })).toBeVisible();
  await expect(page.locator('.org-brand img')).toBeVisible();
  await page.goto('/reservations/r-1/contrat');
  await expect(page.locator('img.ct-logo')).toBeVisible();
  check();
});
