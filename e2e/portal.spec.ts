import { expect, test } from '@playwright/test';
import { failOnErrors, login } from './helpers';

// Petite image PNG valide (1×1) pour simuler la photo d'une pièce.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('espace client : lien, dossier, signature, acompte déclaré puis confirmé', async ({ page }) => {
  const check = failOnErrors(page);
  await login(page, 'direction');
  await page.goto('/reservations/r-6');
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'Espace client' }) });
  await card.getByRole('button', { name: 'Créer le lien client' }).click();
  await expect(card.getByRole('link', { name: 'Envoyer le lien (WhatsApp)' })).toHaveAttribute('href', /wa\.me\/221780000005\?text=.*%2Fc%2F[a-f0-9]{64}/);
  const url = await card.getByRole('link', { name: 'Voir comme le client' }).getAttribute('href');
  expect(url).toMatch(/\/c\/[a-f0-9]{64}$/);

  // Côté client, sans connexion nécessaire.
  await page.goto(new URL(url!).pathname);
  await expect(page.getByRole('heading', { name: /Votre réservation CT-/ })).toBeVisible();
  await page.getByLabel('Permis de conduire').setInputFiles({ name: 'permis.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('label.portal-doc', { hasText: 'Permis de conduire' })).toContainText('Reçue');
  await page.getByRole('button', { name: 'Signer et envoyer' }).click();
  await expect(page.getByRole('alert')).toContainText(/permis est expiré/);
  await page.getByLabel('Permis valable jusqu’au').fill('2030-12-31');
  await page.getByLabel('J’ai lu et j’accepte les conditions de location').check();
  const pad = page.locator('canvas.signature-pad');
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 60, { steps: 8 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Signer et envoyer' }).click();
  await expect(page.getByText(/Contrat signé le .* par Ousmane Fall/)).toBeVisible();

  // Acompte : code marchand du loueur, puis déclaration.
  await expect(page.locator('.portal-code').first()).toHaveText('77 820 00 00');
  await page.getByLabel('Référence de la transaction').fill('T_E2E_42');
  await page.getByRole('button', { name: 'J’ai payé l’acompte' }).click();
  await expect(page.locator('.badge', { hasText: 'En cours de vérification' })).toBeVisible();

  // Retour à l'agence : on confirme après vérification.
  await page.goto('/reservations/r-6');
  await expect(card).toContainText('Acompte déclaré, à vérifier');
  await expect(card).toContainText('Signé en ligne');
  await card.getByRole('button', { name: 'Reçu, confirmer' }).click();
  await expect(card).toContainText('Acompte reçu');
  await expect(page.locator('#paiements').locator('..')).toContainText('réf. T_E2E_42');
  await page.goto('/reservations/r-6/contrat');
  await expect(page.getByText(/signé en ligne le .* par Ousmane Fall/)).toBeVisible();
  check();
});

test('suivi du jour : retards, retours, départs et acompte à vérifier', async ({ page }) => {
  const check = failOnErrors(page);
  await login(page, 'agent');
  await page.goto('/reservations?vue=suivi');
  const day = page.locator('section', { has: page.getByRole('heading', { name: 'Aujourd’hui et demain' }) });
  await expect(day.locator('li', { hasText: 'Pas rentré' }).first().getByRole('link', { name: 'Relancer' })).toHaveAttribute('href', /wa\.me\/.*pr%C3%A9vu/);
  await expect(day.getByRole('link', { name: 'Proposer une prolongation' }).first()).toBeVisible();
  await expect(day.locator('li', { hasText: 'Départ' }).first()).toContainText('Moussa Ndiaye');
  await expect(page.locator('section', { has: page.getByRole('heading', { name: 'Acomptes à suivre' }) })).toContainText('Acompte déclaré, à vérifier');
  check();
});
