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

test('module VTC : payant après l’essai, activable en libre-service', async ({ page }) => {
  const check = failOnErrors(page);
  await login(page, 'admin');
  // Paiement de l'abonnement : l'essai (qui inclut le module) prend fin.
  await page.goto('/abonnement');
  await page.getByRole('button', { name: /^Payer/ }).click();
  await page.getByRole('button', { name: 'Payer avec Wave' }).click();
  await expect(page.getByText('Merci, paiement reçu.')).toBeVisible();
  await page.goto('/vtc');
  await expect(page.getByText('Module en option')).toBeVisible();
  await page.getByRole('link', { name: 'Activer le module' }).click();
  await expect(page.locator('#modules')).toContainText('29 500');
  await page.locator('#modules').getByRole('button', { name: /Activer, payer/ }).click();
  await page.getByRole('button', { name: 'Payer avec Wave' }).click();
  await expect(page.getByText('Le module Chauffeurs VTC est actif')).toBeVisible();
  await page.goto('/vtc');
  await expect(page.getByRole('heading', { name: 'Chauffeurs VTC', level: 1 })).toBeVisible();
  await expect(page.getByText('Module en option')).toHaveCount(0);
  check();
});
