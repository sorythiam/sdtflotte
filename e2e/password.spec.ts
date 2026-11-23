import { test, expect } from '@playwright/test';

test('page « nouveau mot de passe » : contrôle et connexion', async ({ page }) => {
  await page.goto('/nouveau-mot-de-passe');
  await expect(page.getByRole('heading', { name: 'Nouveau mot de passe' })).toBeVisible();
  const [pw, pw2] = [page.locator('input[type=password]').nth(0), page.locator('input[type=password]').nth(1)];
  await pw.fill('motdepasse1');
  await pw2.fill('motdepasse2');
  await page.getByRole('button', { name: /Enregistrer/ }).click();
  await expect(page.getByText('Les deux mots de passe ne sont pas identiques.')).toBeVisible();
});
