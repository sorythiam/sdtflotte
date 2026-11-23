import { expect, type Locator, type Page } from '@playwright/test';

/** Connexion en mode démo avec un profil, données d'exemple neuves. */
export async function login(page: Page, role: 'admin' | 'direction' | 'agent' | 'comptable' | 'mecanicien' = 'admin') {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('input[type=email]').fill(`${role}@sdt.sn`);
  await page.locator('input[type=text]').fill(role);
  await page.getByRole('button', { name: 'Se connecter' }).last().click();
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
}

/** Liste déroulante d'un champ par le début de son libellé. */
export const field = (scope: Page | Locator, label: string) => scope.locator('label.field', { hasText: new RegExp('^' + label) }).locator('select, input').first();

const pad = (n: number) => String(n).padStart(2, '0');
/** Valeur d'un champ date-heure, décalée de `days` jours à l'heure `hour`. */
export function localInput(days: number, hour: number): string {
  const d = new Date(Date.now() + days * 86400000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:00`;
}

/** Échoue le test à la moindre erreur JavaScript dans la page. */
export function failOnErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => void d.accept());
  return () => expect(errors, errors.join('\n')).toEqual([]);
}
