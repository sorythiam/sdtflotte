import { expect, test } from '@playwright/test';
import { failOnErrors, login } from './helpers';

test('abonnement : l’administrateur paie seul et la formule s’active', async ({ page }) => {
  const check = failOnErrors(page);
  await login(page, 'admin');
  await page.goto('/abonnement');
  await page.getByRole('radio').nth(2).check(); // Entreprise
  await page.getByLabel('Nombre de véhicules').fill('35');
  await expect(page.locator('.notice').filter({ hasText: 'à payer maintenant' })).toContainText('1 982 400');
  await page.getByRole('button', { name: /^Payer/ }).click();
  await expect(page.getByRole('heading', { name: 'Page de paiement' })).toBeVisible();
  await page.getByRole('button', { name: 'Payer avec Wave' }).click();
  await expect(page.getByText('Merci, paiement reçu.')).toBeVisible();
  await page.getByRole('link', { name: /Voir la facture YF-/ }).click();
  await expect(page.locator('.paper')).toContainText('Abonnement Yoon Fleet Entreprise, 35 véhicules');
  await page.goto('/abonnement');
  await expect(page.locator('section', { hasText: 'Votre abonnement' }).first()).toContainText('Entreprise');
  await expect(page.locator('section', { hasText: 'Votre abonnement' }).first()).toContainText('sur 35 prévus');
  check();
});

test('abonnement : un agent ne peut pas payer', async ({ page }) => {
  await login(page, 'agent');
  await page.goto('/abonnement');
  await expect(page.getByText('Seul l’administrateur du compte peut payer')).toBeVisible();
});
