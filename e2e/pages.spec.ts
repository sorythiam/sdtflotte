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
