import { expect, test } from '@playwright/test';
import { allCranes, seedCrane, simplePdf, uniq } from './fixtures.ts';

const file = (name: string, buffer = simplePdf()) => ({
  name,
  mimeType: 'application/pdf',
  buffer,
});

test('uploads a crane through the dialog', async ({ page }) => {
  const make = uniq('Ui');
  await page.goto('/');
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Upload crane specification' });
  await dialog.getByLabel('PDF file').setInputFiles(file(`${make} U1.pdf`));
  await expect(dialog.getByLabel('Manufacturer')).toHaveValue(make);
  await expect(dialog.getByLabel('Model')).toHaveValue('U1');
  await dialog.getByLabel('Type').fill('Mobile');
  await dialog.getByLabel('Rated capacity').fill('60t');
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(`.make-item[data-make="${make}"]`)).toBeVisible();
});

test('a duplicate upload shows the server’s error in the dialog', async ({ page }) => {
  const make = uniq('Dup');
  await seedCrane(page, { make, model: 'D1', capacity: '5t' });
  await page.goto('/');
  await page.keyboard.press('Control+u');
  const dialog = page.getByRole('dialog', { name: 'Upload crane specification' });
  await dialog.getByLabel('PDF file').setInputFiles(file('x.pdf'));
  await dialog.getByLabel('Manufacturer').fill(make);
  await dialog.getByLabel('Type').fill('Mobile');
  await dialog.getByLabel('Model').fill('D1');
  await dialog.getByLabel('Rated capacity').fill('5t');
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('exist');
  await expect(dialog).toBeVisible();
});

test('a PDF dropped on the picker is chosen and fills in its details', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Upload crane specification' });
  const data = await page.evaluateHandle((b64) => {
    const dt = new DataTransfer();
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    dt.items.add(new File([bytes], 'Grove GMK5150 (Load Chart).pdf', { type: 'application/pdf' }));
    return dt;
  }, simplePdf().toString('base64'));
  await dialog.locator('.file-field').dispatchEvent('drop', { dataTransfer: data });
  await expect(dialog.getByText('Grove GMK5150 (Load Chart).pdf')).toBeVisible();
  await expect(dialog.getByLabel('Manufacturer')).toHaveValue('Grove');
  await expect(dialog.getByLabel('Model')).toHaveValue('GMK5150');
});

test('a PDF dropped on the window with a crane open becomes one of its files', async ({ page }) => {
  const crane = await seedCrane(page, { make: uniq('Drop'), model: 'W1' });
  await page.goto(`/#crane/${encodeURIComponent(crane.id)}`);
  await expect(page.getByRole('tablist', { name: 'Documents for this crane' })).toBeVisible();
  const data = await page.evaluateHandle((b64) => {
    const dt = new DataTransfer();
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    dt.items.add(new File([bytes], 'dims.pdf', { type: 'application/pdf' }));
    return dt;
  }, simplePdf().toString('base64'));
  await page.locator('body').dispatchEvent('drop', { dataTransfer: data });
  const dialog = page.getByRole('dialog', { name: `Add file to ${crane.make} W1` });
  await dialog.getByLabel('File label — optional').fill('Dimensions');
  await dialog.getByRole('button', { name: 'Add file' }).click();
  await expect(page.getByRole('tab', { name: 'Dimensions' })).toBeVisible();
});

test('bulk import groups files into cranes and creates them', async ({ page }) => {
  const a = uniq('Bulka');
  const b = uniq('Bulkb');
  await page.goto('/');
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Upload crane specification' })
    .getByLabel('PDF file')
    .setInputFiles([
      file(`${a} LTM1100 (Load Chart).pdf`),
      file(`${a} LTM1100 (Outrigger).pdf`),
      file(`${b} AC100.pdf`),
    ]);
  const bulk = page.getByRole('dialog', { name: 'Import several PDFs' });
  await expect(bulk.getByText(/3 files → 2 cranes/)).toBeVisible();
  await expect(bulk.locator('.bulk__input[aria-label="make"]').first()).toHaveValue(a);
  await bulk.getByLabel('Set all types').fill('Mobile');
  await bulk.getByRole('button', { name: 'Apply to all' }).click();
  for (const input of await bulk.locator('input[aria-label="capacity"]').all())
    await input.fill('100t');
  await bulk
    .locator('.bulk__file')
    .filter({ hasText: 'Outrigger' })
    .locator('input[type=radio]')
    .check();
  await bulk.getByRole('button', { name: 'Import' }).click();
  await expect(bulk).toBeHidden();
  const cranes = await allCranes(page);
  const first = cranes.find((c) => c.make === a);
  expect(first?.id).toBe(`${a.toLowerCase()}_mobile_ltm1100_100t`);
  expect(first?.files.find((f) => f.is_primary)?.label).toBe('Outrigger');
  expect(first?.file_count).toBe(2);
  expect(cranes.some((c) => c.id === `${b.toLowerCase()}_mobile_ac100_100t`)).toBe(true);
});
