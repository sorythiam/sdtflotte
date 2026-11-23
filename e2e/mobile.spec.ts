import { expect, test } from '@playwright/test';
import { failOnErrors, login } from './helpers';

test('téléphone : navigation du bas et aucune page plus large que l’écran', async ({ page }) => {
  const check = failOnErrors(page);
  await login(page, 'agent');
  for (const r of ['/', '/reservations', '/vehicules', '/clients/c-sante', '/factures', '/vtc', '/vtc/vtc-1']) {
    await page.goto(r);
    await expect(page.locator('.bottombar')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow, r).toBeLessThanOrEqual(2);
  }
  await page.getByRole('button', { name: 'Plus', exact: true }).click();
  await expect(page.locator('.sheet')).toContainText('Chauffeurs VTC');
  check();
});
