// Screenshots for docs/screenshots/, in both themes and at phone width. Only with
// SCREENSHOTS=1 (sh scripts/e2e.sh screenshots): they are reviewed and committed by hand.
import { expect, test, type Page } from '@playwright/test';
import { makePdf, seedCrane, seedFile, uniq } from './fixtures.ts';

test.skip(!process.env.SCREENSHOTS, 'SCREENSHOTS=1 to write docs/screenshots');

async function catalogue(page: Page) {
  const tag = uniq('');
  const lines = [
    'Rated capacity 250 t',
    'Radius 3 m: 250 t',
    'Radius 10 m: 120 t',
    'Radius 20 m: 54 t',
  ];
  const main = await seedCrane(
    page,
    { make: 'Liebherr', type: 'Mobile', model: `LTM 1250-5.1 ${tag}`, capacity: '250t' },
    makePdf([lines, ['Counterweight 64 t'], ['Transport dimensions']])
  );
  await seedFile(page, main.id, 'Outrigger chart');
  for (const [make, type, model, capacity] of [
    ['Liebherr', 'Mobile', 'LTM 1100-5.2', '100t'],
    ['Liebherr', 'Crawler', 'LR 1300', '300t'],
    ['Tadano', 'Mobile', 'AC 4.080-1', '80t'],
    ['Grove', 'Mobile', 'GMK5150L', '150t'],
  ] as const)
    await seedCrane(page, { make, type, model: `${model} ${tag}`, capacity });
  return main;
}

for (const theme of ['light', 'dark'] as const) {
  test(`desktop, ${theme}`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('hhh.theme', t), theme);
    await page.setViewportSize({ width: 1440, height: 900 });
    const main = await catalogue(page);
    await page.goto(`/#crane/${encodeURIComponent(main.id)}`);
    await expect(page.locator('#zoom-level')).toHaveText(/\d+%/);
    await page.getByRole('button', { name: 'Find in document' }).click();
    await page.getByRole('searchbox', { name: 'Find in document' }).fill('250 t');
    await expect(page.locator('#find-count')).toHaveText(/\/2$/);
    await page.screenshot({ path: `docs/screenshots/viewer-${theme}.png` });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('button', { name: 'Back up now' })).toBeVisible();
    await page.screenshot({ path: `docs/screenshots/settings-${theme}.png` });
  });

  test(`phone, ${theme}`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('hhh.theme', t), theme);
    await page.setViewportSize({ width: 390, height: 844 });
    const main = await catalogue(page);
    await page.goto(`/#crane/${encodeURIComponent(main.id)}`);
    await expect(page.locator('#zoom-level')).toHaveText(/\d+%/);
    await page.screenshot({ path: `docs/screenshots/phone-viewer-${theme}.png` });
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
    await expect(page.locator('#sidebar')).toHaveClass(/is-open/);
    // Wait for the slide-in to finish.
    await expect.poll(async () => (await page.locator('#sidebar').boundingBox())?.x).toBe(0);
    await page.screenshot({ path: `docs/screenshots/phone-sidebar-${theme}.png` });
  });
}
