import { expect, test } from '@playwright/test';
import { failOnErrors, login } from './helpers';

const routes = [
  '/', '/planning', '/reservations', '/reservations/r-1', '/reservations/r-1/contrat', '/demandes', '/vehicules', '/vehicules/v-hiace',
  '/chauffeurs', '/maintenance', '/depenses', '/tarifs', '/clients', '/clients/c-sante', '/factures', '/rapports', '/parametres',
  '/equipe', '/journal', '/vtc', '/vtc/vtc-1', '/dossiers/g-1',
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

test('chauffeurs : planning de la semaine, absence et feuille de mission', async ({ page }) => {
  const check = failOnErrors(page);
  await login(page, 'direction');
  await page.goto('/chauffeurs?vue=planning');
  await expect(page.getByRole('tab', { name: 'Planning de la semaine' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Semaine suivante' }).click();
  await page.getByRole('button', { name: 'Semaine suivante' }).click();
  await expect(page.locator('.drv-absence').first()).toBeVisible();
  // Absence ajoutée depuis la fiche du chauffeur.
  await page.getByRole('button', { name: 'Modou Faye' }).click();
  const m = page.locator('.modal');
  await m.getByLabel('Motif').selectOption('maladie');
  await m.getByRole('button', { name: 'Ajouter l’absence' }).click();
  await expect(m.getByText(/Maladie du/)).toBeVisible();
  await m.getByRole('button', { name: 'Annuler' }).click();
  // Feuille de mission du transfert aéroport de demain.
  await page.goto('/reservations?vue=suivi');
  await expect(page.getByRole('link', { name: /Feuille de mission à Ibrahima/ })).toHaveAttribute('href', /wa\.me\/.*AF718/);
  check();
});

test('dossier de groupe : plusieurs véhicules, relevé et paiement global', async ({ page }) => {
  const check = failOnErrors(page);
  await login(page, 'direction');
  // Dossier d'exemple : deux véhicules pour Mission Teranga Tours.
  await page.goto('/dossiers/g-1');
  await expect(page.getByRole('heading', { name: /Dossier DO-\d{4}-0001/ })).toBeVisible();
  await expect(page.locator('table.data tbody tr')).toHaveCount(2);
  await expect(page.getByText('Relevé de dossier')).toBeVisible();
  await page.getByRole('button', { name: 'Encaisser pour le dossier' }).click();
  const m = page.locator('.modal');
  await expect(m.getByText(/Répartition/)).toBeVisible();
  await m.getByLabel('Moyen de paiement').selectOption('wave');
  await m.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText(/encaissés sur 2 contrat/)).toBeVisible();

  // Nouvelle réservation à deux véhicules : un dossier est créé.
  await page.goto('/reservations?nouvelle=1');
  const f = page.locator('.modal');
  const start = new Date(Date.now() + 30 * 86400000);
  const end = new Date(Date.now() + 32 * 86400000);
  const local = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T09:00`;
  await f.getByLabel('Départ', { exact: true }).fill(local(start));
  await f.getByLabel('Retour prévu').fill(local(end));
  await f.getByLabel('Passagers').fill('6');
  await f.getByLabel('Véhicule').first().selectOption({ index: 1 });
  await f.getByRole('button', { name: '+ Ajouter un véhicule' }).click();
  await f.getByLabel(/^Véhicule 2/).selectOption({ index: 2 });
  await f.getByLabel('Client').selectOption('c-sante');
  await f.getByLabel('Nom du dossier (facultatif)').fill('Mission Kaolack');
  await f.getByRole('button', { name: /Créer le dossier \(2 véhicules\)/ }).click();
  await expect(page).toHaveURL(/\/dossiers\//);
  await expect(page.getByText('Mission Kaolack').first()).toBeVisible();
  await expect(page.locator('table.data tbody tr')).toHaveCount(2);
  check();
});

test('console Yoon Fleet : inscriptions à appeler et suivi', async ({ page }) => {
  const check = failOnErrors(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('input[type=email]').fill('tbg@yoonfleet.com');
  await page.locator('input[type=text]').fill('admin');
  await page.getByRole('button', { name: 'Se connecter' }).last().click();
  await page.getByRole('link', { name: 'Console Yoon Fleet' }).first().click();
  await expect(page.getByRole('heading', { name: 'Inscriptions et essais' })).toBeVisible();
  const first = page.locator('table.data tbody tr').first();
  await expect(first).toContainText('Dakar Auto Location');
  await expect(first.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', /wa\.me\/221/);
  await first.getByRole('button', { name: 'Noter l’appel' }).click();
  await page.locator('.modal').getByLabel('Note').fill('8 véhicules, saisis ensemble.');
  await page.locator('.modal').getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Suivi enregistré')).toBeVisible();
  await page.getByRole('button', { name: 'Toutes les inscriptions' }).click();
  await expect(page.getByText('8 véhicules, saisis ensemble.')).toBeVisible();
  check();
});

test('l’inscription depuis une publicité demande le nom et le WhatsApp du gérant', async ({ page }) => {
  await page.goto('/?utm_source=facebook&utm_campaign=lancement');
  await expect(page.getByRole('tab', { name: 'Essai gratuit 30 jours' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Numéro WhatsApp')).toBeVisible();
  await expect(page.getByLabel('Votre nom')).toBeVisible();
});
