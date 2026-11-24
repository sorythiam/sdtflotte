import { expect, test } from '@playwright/test';
import { failOnErrors, login } from './helpers';

test('VTC : versement qui solde le retard', async ({ page }) => {
  const check = failOnErrors(page);
  await login(page, 'agent');
  await page.goto('/vtc?vue=contrats');
  const row = page.locator('tbody tr', { hasText: 'Modou Faye' });
  await row.getByRole('button', { name: 'Versement' }).click();
  const m = page.locator('.modal');
  await m.getByRole('button', { name: 'Tout le solde' }).click();
  await m.getByLabel('Référence de la transaction').fill('E2E-1');
  await m.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(m.getByRole('link', { name: 'Envoyer le reçu' })).toHaveAttribute('href', /wa\.me\/.*confirme/);
  await m.getByRole('button', { name: 'Terminé' }).click();
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

test('VTC : point du jour, saisie groupée, jour non dû et caisse', async ({ page }) => {
  const check = failOnErrors(page);
  await login(page, 'direction');
  await page.goto('/vtc');
  await expect(page.getByRole('tab', { name: 'Point du jour' })).toHaveAttribute('aria-selected', 'true');
  // Saisie groupée en espèces pour les deux chauffeurs.
  for (const name of ['Modou Faye', 'Pape Diallo']) {
    const row = page.locator('tbody tr', { hasText: name });
    await row.getByLabel(/Montant reçu/).fill('15000');
  }
  await page.getByRole('button', { name: /Enregistrer 2 versement/ }).click();
  await expect(page.locator('.modal').getByRole('link', { name: 'Envoyer le reçu' })).toHaveCount(2);
  await page.locator('.modal').getByRole('button', { name: 'Terminé' }).click();
  // Les espèces sont dans la caisse de la direction connectée.
  await page.getByRole('tab', { name: 'Caisse' }).click();
  const mine = page.locator('li.card', { hasText: 'direction@sdt.sn' });
  await expect(mine).toContainText('30');
  await mine.getByRole('button', { name: 'Remise reçue' }).click();
  await expect(page.locator('li.card', { hasText: 'direction@sdt.sn' })).toHaveCount(0);
  // Jour non dû depuis la fiche.
  await page.goto('/vtc?vue=contrats');
  await page.locator('tbody tr', { hasText: 'Modou Faye' }).getByRole('link', { name: 'Modou Faye' }).click();
  await page.getByRole('button', { name: /Déclarer des jours non dus/ }).click();
  const m = page.locator('.modal');
  const from = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  await m.getByLabel('Du', { exact: true }).fill(from);
  await m.getByRole('button', { name: 'Déclarer' }).click();
  await expect(page.locator('section', { hasText: 'Avances, remises, jours non dus' }).first()).toContainText('Jour non dû');
  check();
});
