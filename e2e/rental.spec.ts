import { expect, test } from '@playwright/test';
import { failOnErrors, field, localInput, login } from './helpers';

test('parcours complet : réservation, acompte, départ, retour', async ({ page }) => {
  const check = failOnErrors(page);
  await login(page, 'agent');
  await page.goto('/reservations');
  await page.getByRole('button', { name: /Nouvelle réservation/ }).first().click();
  const m = page.locator('.modal');
  await m.getByLabel('Départ').fill(localInput(-1, 9));
  await m.getByLabel('Retour prévu').fill(localInput(1, 9));
  const vehicle = field(m, 'Véhicule');
  const free = await vehicle.locator('option:not([disabled])').allTextContents();
  await vehicle.selectOption({ label: free[1] });
  await field(m, 'Client').selectOption({ label: 'Aïssatou Diop' });
  await expect(m.locator('.notice')).toContainText('FCFA');
  await m.getByRole('button', { name: 'Créer la réservation' }).click();
  await expect(page).toHaveURL(/\/reservations\/[\w-]+$/);

  await page.getByRole('button', { name: 'Encaisser un paiement' }).click();
  await page.locator('.modal').getByRole('button', { name: /Enregistrer|Encaisser/ }).last().click();
  await expect(page.locator('main')).toContainText('Acompte');

  await page.getByRole('button', { name: 'Départ rapide' }).click();
  await page.locator('.modal').getByRole('button').last().click();
  await expect(page.locator('main')).toContainText('En cours');

  await page.getByRole('button', { name: 'Retour rapide' }).click();
  await page.locator('.modal').getByRole('button').last().click();
  await expect(page.locator('main')).toContainText('Terminée');
  check();
});

test('annulation avec acompte : frais conservés et reste dû juste', async ({ page }) => {
  const check = failOnErrors(page);
  await login(page, 'admin');
  await page.goto('/reservations/r-8');
  await page.getByRole('button', { name: 'Annuler', exact: true }).click();
  const m = page.locator('.modal');
  await m.getByLabel(/Autre montant/).check();
  await m.getByRole('spinbutton', { name: 'Frais d’annulation' }).fill('150000');
  await expect(m.locator('.notice')).toContainText('30 000 FCFA');
  await m.getByRole('button', { name: 'Annuler la réservation' }).click();
  await expect(page.locator('main')).toContainText('Annulée');
  await expect(page.locator('main')).toContainText('30 000 FCFA');
  check();
});

test('prolongation : avenant et facture complémentaire', async ({ page }) => {
  const check = failOnErrors(page);
  await login(page, 'admin');
  await page.goto('/reservations');
  await page.getByRole('button', { name: /Nouvelle réservation/ }).first().click();
  const m = page.locator('.modal');
  await m.getByLabel('Départ').fill(localInput(40, 9));
  await m.getByLabel('Retour prévu').fill(localInput(42, 9));
  await field(m, 'Véhicule').selectOption({ label: (await field(m, 'Véhicule').locator('option', { hasText: 'Picanto' }).textContent())!.trim() });
  await field(m, 'Client').selectOption({ label: 'Aïssatou Diop' });
  await m.getByRole('button', { name: 'Créer la réservation' }).click();
  await expect(page).toHaveURL(/\/reservations\/[\w-]+$/);
  await page.getByRole('button', { name: 'Modifier' }).click();
  const a = page.locator('.modal');
  await a.getByLabel('Nouveau retour').fill(localInput(44, 9));
  await expect(a.locator('.notice')).toContainText('en hausse');
  await a.getByRole('button', { name: /Enregistrer l’avenant/ }).click();
  await expect(page.locator('main')).toContainText('Avenant 1');
  await expect(page.locator('main')).toContainText('Facture complémentaire');
  check();
});
