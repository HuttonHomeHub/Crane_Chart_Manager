import { expect, test, type Page } from '@playwright/test';
import { allCranes, seedCrane, uniq } from './fixtures.ts';

const openSettings = async (page: Page) => {
  await page.getByRole('button', { name: 'Settings' }).click();
  return page.getByRole('dialog').filter({ hasText: 'Backups' });
};

test('settings shows this instance and makes and downloads backups', async ({ page }) => {
  await page.goto('/');
  const panel = await openSettings(page);
  await expect(panel.getByText('Version')).toBeVisible();
  await expect(panel.getByText('Database')).toBeVisible();
  await panel.getByRole('button', { name: 'Back up now' }).click();
  const item = panel.locator('.hhh-backups__item').first();
  await expect(item).toContainText(/crane-backup-\d{8}-\d{6}\.zip/);
  const [one] = await Promise.all([
    page.waitForEvent('download'),
    item.getByRole('link', { name: 'Download' }).click(),
  ]);
  expect(one.suggestedFilename()).toMatch(/^crane-backup-.*\.zip$/);
  const [fresh] = await Promise.all([
    page.waitForEvent('download'),
    panel.getByRole('link', { name: 'Download fresh' }).click(),
  ]);
  expect(fresh.suggestedFilename()).toMatch(/\.zip$/);
});

test('restoring a backup brings back what it held', async ({ page }) => {
  const keep = uniq('Keepco');
  const later = uniq('Laterco');
  const kept = await seedCrane(page, { make: keep });
  await page.goto('/');
  let panel = await openSettings(page);
  await panel.getByRole('button', { name: 'Back up now' }).click();
  await expect(panel.locator('.hhh-backups__item').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await seedCrane(page, { make: later });
  const token = (await page.context().cookies()).find((c) => c.name === 'hhh_csrf')?.value ?? '';
  await page.request.delete(`/api/delete/${encodeURIComponent(kept.id)}`, {
    headers: { 'X-CSRF-Token': token },
  });
  await page.reload();
  await expect(page.locator(`.make-item[data-make="${later}"]`)).toBeVisible();
  panel = await openSettings(page);
  await panel
    .locator('.hhh-backups__item')
    .first()
    .getByRole('button', { name: 'Restore' })
    .click();
  await page
    .getByRole('dialog', { name: 'Restore this backup?' })
    .getByRole('button', { name: 'Restore' })
    .click();
  await expect(page.locator(`.make-item[data-make="${keep}"]`)).toHaveCount(1);
  await expect(page.locator(`.make-item[data-make="${later}"]`)).toHaveCount(0);
  const makes = (await allCranes(page)).map((c) => c.make);
  expect(makes).toContain(keep);
  expect(makes).not.toContain(later);
});

test('merging moves one manufacturer’s cranes onto another', async ({ page }) => {
  const into = uniq('Liebherr');
  const typo = `${into}i`;
  await seedCrane(page, { make: typo, model: 'MG1' });
  await seedCrane(page, { make: into, model: 'MG2' });
  await page.goto('/');
  const panel = await openSettings(page);
  await panel.getByLabel('From').selectOption(typo);
  await panel.getByLabel('Into').selectOption(into);
  await panel.getByRole('button', { name: 'Merge', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Confirm merge' })
    .getByRole('button', { name: 'Merge' })
    .click();
  await expect(panel.getByRole('status').filter({ hasText: 'Merged' })).toContainText(
    `Merged 1 crane into “${into}”.`
  );
  expect((await allCranes(page)).filter((c) => c.make === into)).toHaveLength(2);
});
