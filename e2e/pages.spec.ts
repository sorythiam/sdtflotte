import { expect, test } from '@playwright/test';
import { failOnErrors, login } from './helpers';

const routes = [
  '/', '/planning', '/reservations', '/reservations/r-1', '/reservations/r-1/contrat', '/demandes', '/vehicules', '/vehicules/v-hiace',
  '/chauffeurs', '/maintenance', '/depenses', '/tarifs', '/clients', '/clients/c-sante', '/factures', '/rapports', '/parametres',
  '/equipe', '/journal', '/vtc', '/vtc/vtc-1',
];

for (const role of ['admin', 'agent', 'comptable', 'mecanicien'] as const) {
  test(`toutes les pages s'ouvrent sans erreur (${role})`, async ({ page }) => {
    const check = failOnErrors(page);
    await login(page, role);
    for (const r of routes) {
      await page.goto(r);
      await expect(page.locator('main')).not.toBeEmpty();
      await expect(page.locator('body')).not.toContainText(/introuvable|Something went wrong/i);
    }
    check();
  });
}

test('la page publique de réservation fonctionne', async ({ page }) => {
  const check = failOnErrors(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/r/sdt-demo');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByLabel('Passagers').fill('20');
  await expect(page.getByText('Trop petit').first()).toBeVisible();
  check();
});

test('transfert aéroport : demande en ligne avec le vol, puis réservation', async ({ page }) => {
  const check = failOnErrors(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/r/sdt-demo');
  await page.getByLabel('C’est un trajet vers ou depuis l’aéroport').check();
  await page.getByLabel('Numéro de vol').fill('af 718');
  const at = new Date(Date.now() + 2 * 86400000);
  const local = new Date(at.getTime() - at.getTimezoneOffset() * 60000).toISOString().slice(0, 11) + '14:30';
  await page.getByLabel('Heure d’arrivée du vol').fill(local);
  await expect(page.getByLabel('Prise en charge', { exact: true })).toHaveValue(local);
  await page.locator('.pub-cat-body:not([disabled])').first().click();
  await page.getByLabel('Nom et prénom').fill('Jean Voyageur');
  await page.getByLabel(/Téléphone/).fill('77 111 22 33');
  await page.getByRole('button', { name: 'Envoyer ma demande' }).click();
  await expect(page.getByRole('heading', { name: 'Demande envoyée' })).toBeVisible();

  await login(page, 'direction');
  // La démo garde les demandes dans le navigateur : la connexion a réinitialisé l'état, on refait la demande connecté.
  await page.goto('/reservations');
  await page.getByRole('button', { name: /Nouvelle réservation/ }).click();
  const m = page.locator('.modal');
  await m.getByLabel('C’est un trajet vers ou depuis l’aéroport').check();
  await m.getByLabel('Numéro de vol').fill('SN205');
  await m.getByLabel('Heure d’arrivée du vol').fill(local);
  await expect(m.getByLabel('Prise en charge', { exact: true })).toHaveValue(local);
  await m.getByLabel('Retour prévu').fill(local.slice(0, 11) + '17:30');
  await m.getByLabel('Véhicule').selectOption({ index: 1 });
  await m.getByLabel('Client').selectOption({ index: 1 });
  await m.getByRole('button', { name: 'Créer la réservation' }).click();
  await expect(page.getByText(/Vol SN205, arrivée prévue le/)).toBeVisible();
  check();
});
