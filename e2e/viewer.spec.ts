import { expect, test } from '@playwright/test';
import { makePdf, seedCrane, seedFile, uniq } from './fixtures.ts';

test('the strip switches files and sets the main one', async ({ page }) => {
  const crane = await seedCrane(page, { make: uniq('Strip'), model: 'S1' });
  await seedFile(page, crane.id, 'Outrigger chart');
  await page.goto('/');
  await page.locator(`.make-item[data-make="${crane.make}"]`).click();
  const row = page.locator(`.model-item[data-filename="${crane.id}"]`);
  await expect(row.locator('.model-item__filecount')).toHaveText('2');
  await row.locator('.model-item__body').click();
  await expect(page.locator('.file-chip')).toHaveCount(2);
  await page.getByRole('tab', { name: 'Outrigger chart' }).click();
  await expect(page.getByRole('tab', { name: 'Outrigger chart' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await page.getByRole('button', { name: 'Set Outrigger chart as main file' }).click();
  await expect(page.locator('.file-chip').filter({ hasText: 'Outrigger chart' })).toHaveClass(
    /is-primary/
  );
});

test('deleting an extra file keeps the crane', async ({ page }) => {
  const crane = await seedCrane(page, { make: uniq('Keep'), model: 'K1' });
  await seedFile(page, crane.id, 'Extra');
  await page.goto(`/#crane/${encodeURIComponent(crane.id)}`);
  await page.getByRole('button', { name: 'Delete Extra' }).click();
  await page
    .getByRole('dialog', { name: 'Confirm deletion' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(page.locator('.file-chip')).toHaveCount(1);
  await expect(page.locator('#info-model')).toHaveText('K1');
});

test('a file label can be renamed', async ({ page }) => {
  const crane = await seedCrane(page, { make: uniq('Label'), model: 'L1' });
  await page.goto(`/#crane/${encodeURIComponent(crane.id)}`);
  await page.getByRole('button', { name: 'Rename chart.pdf' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename file' });
  await dialog.getByLabel('File label — optional').fill('Primary load chart');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('tab', { name: 'Primary load chart' })).toBeVisible();
});

test('find highlights matches across pages and steps through them', async ({ page }) => {
  const crane = await seedCrane(
    page,
    { make: uniq('Find'), model: 'F1' },
    makePdf([['Max 250t', 'Radius 10m'], ['Counterweight'], ['250t at 6m']])
  );
  await page.goto(`/#crane/${encodeURIComponent(crane.id)}`);
  await expect(page.locator('#page-total')).toHaveText('3');
  await page.getByRole('button', { name: 'Find in document' }).click();
  await page.getByRole('searchbox', { name: 'Find in document' }).fill('250t');
  await expect(page.locator('#find-count')).toHaveText('1/2');
  await expect(page.locator('.pdf-highlight')).toHaveCount(1);
  await expect(page.locator('.pdf-highlight.is-current')).toHaveCount(1);
  await page.getByRole('button', { name: 'Next match' }).click();
  await expect(page.locator('#find-count')).toHaveText('2/2');
  await expect(page.getByRole('spinbutton', { name: 'Page' })).toHaveValue('3');
  await expect(page.locator('.pdf-highlight.is-current')).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Find in document' }).fill('nowhere');
  await expect(page.locator('#find-count')).toHaveText('0/0');
  await expect(page.locator('.pdf-highlight')).toHaveCount(0);
});

test('a #crane/ link opens that crane on load', async ({ page }) => {
  const crane = await seedCrane(page, { make: uniq('Link'), model: 'DL1' });
  await page.goto(`/#crane/${encodeURIComponent(crane.id)}`);
  await expect(page.locator('#info-model')).toHaveText('DL1');
  await expect(page.locator(`.model-item[data-filename="${crane.id}"]`)).toHaveClass(/is-active/);
  await expect(page).toHaveTitle(`${crane.make} DL1 · Crane Charts`);
});

test('the keyboard pages and zooms the open PDF', async ({ page }) => {
  const crane = await seedCrane(
    page,
    { make: uniq('Keys'), model: 'K2' },
    makePdf([['one'], ['two']])
  );
  await page.goto(`/#crane/${encodeURIComponent(crane.id)}`);
  await expect(page.locator('#page-total')).toHaveText('2');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('spinbutton', { name: 'Page' })).toHaveValue('2');
  const before = await page.locator('#zoom-level').innerText();
  await page.keyboard.press('+');
  await expect(page.locator('#zoom-level')).not.toHaveText(before);
});
