import { expect, test } from '@playwright/test';
import { seedCrane, uniq } from './fixtures.ts';

test('the palette finds a crane by words or by capacity and opens it', async ({ page }) => {
  const make = uniq('Zpalette');
  await seedCrane(page, { make, model: 'Zzlow', capacity: '91001t' });
  const high = await seedCrane(page, { make, model: 'Zzhigh', capacity: '99001t' });
  await page.goto('/');
  await page.keyboard.press('Control+k');
  const input = page.getByRole('combobox', { name: 'Jump to a crane' });
  await input.fill(`${make} zzlow`);
  await expect(page.locator('.palette__result')).toHaveCount(1);
  await input.fill('>=99000');
  await expect(page.locator('.palette__result')).toHaveCount(1);
  await expect(page.locator('.palette__result')).toContainText('Zzhigh');
  await input.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Find a crane' })).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`#crane/${high.id}$`));
  await expect(page.locator('#info-model')).toHaveText('Zzhigh');
});

test('? lists the keyboard shortcuts', async ({ page }) => {
  await page.goto('/');
  await page.locator('body').press('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toContainText(
    'Find a crane'
  );
});
