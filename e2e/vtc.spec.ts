import { expect, test } from '@playwright/test';
import { failOnErrors, login } from './helpers';

test('VTC : versement qui solde le retard', async ({ page }) => {
  const check = failOnErrors(page);
  await login(page, 'agent');
  await page.goto('/vtc');
  const row = page.locator('tbody tr', { hasText: 'Modou Faye' });
  await row.getByRole('button', { name: 'Versement' }).click();
  const m = page.locator('.modal');
  await m.getByRole('button', { name: 'Tout le solde' }).click();
  await m.getByLabel('Référence de la transaction').fill('E2E-1');
  await m.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(row).toContainText('À jour');
  check();
});

test('un véhicule en VTC n’est pas proposé à la location', async ({ page }) => {
  await login(page, 'agent');
  await page.goto('/reservations');
  await page.getByRole('button', { name: /Nouvelle réservation/ }).first().click();
  const opt = page.locator('.modal label.field', { hasText: /^Véhicule/ }).locator('option', { hasText: 'Celerio' });
  await expect(opt).toHaveAttribute('disabled', '');
  await expect(opt).toContainText('indisponible');
});
