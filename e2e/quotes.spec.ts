import { expect, test } from '@playwright/test';
import { failOnErrors, field, localInput, login } from './helpers';

test('devis : création, impression, transformation en réservations', async ({ page }) => {
  const check = failOnErrors(page);
  await login(page, 'agent');
  await page.goto('/devis');
  await page.getByRole('button', { name: 'Nouveau devis' }).click();
  const m = page.locator('.modal');
  await field(m, 'Client').selectOption({ label: 'Mission Teranga Tours' });
  await field(m, 'Catégorie').selectOption('4x4');
  await field(m, 'Nombre de véhicules').fill('2');
  await field(m, 'Départ').fill(localInput(45, 9));
  await field(m, 'Retour').fill(localInput(47, 9));
  await expect(m.locator('.notice')).toContainText('HT');
  await m.getByRole('button', { name: 'Créer le devis' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/Devis DV-\d{4}-\d{4}/);
  await expect(page.locator('.paper')).toContainText('2 × 4x4');
  await expect(page.locator('.paper')).toContainText('Bon pour accord');
  await page.getByRole('button', { name: 'Accepté' }).click();
  await expect(page.locator('.page-head .badge')).toHaveText('Accepté');
  await page.getByRole('button', { name: 'Transformer en réservation' }).click();
  await page.locator('.modal').getByRole('button', { name: /Créer les 2 réservations/ }).click();
  await expect(page).toHaveURL(/\/reservations$/);
  await expect(page.locator('tbody tr', { hasText: 'Mission Teranga Tours' }).first()).toBeVisible();
  check();
});

test('rentabilité et saisons s’affichent', async ({ page }) => {
  const check = failOnErrors(page);
  await login(page, 'direction');
  await page.goto('/rentabilite');
  await expect(page.getByRole('heading', { name: 'Détail par véhicule' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Quel modèle racheter ?' })).toBeVisible();
  await page.goto('/tarifs');
  await expect(page.getByRole('heading', { name: 'Saisons tarifaires' })).toBeVisible();
  await expect(page.locator('section', { hasText: 'Saisons tarifaires' })).toContainText('Haute saison');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Bien démarrer avec Yoon Fleet' })).toBeVisible();
  await page.getByRole('button', { name: 'Masquer' }).click();
  await expect(page.getByRole('heading', { name: 'Bien démarrer avec Yoon Fleet' })).toHaveCount(0);
  check();
});
