import { expect, test } from '@playwright/test';
import { allCranes, chooseMake, seedCrane, uniq } from './fixtures.ts';

test('a crane added through the API appears in the sidebar', async ({ page }) => {
  const make = uniq('Tadano');
  await seedCrane(page, { make });
  await page.goto('/');
  await expect(page.locator(`.make-item[data-make="${make}"]`)).toBeVisible();
});

test('the pencil edits a crane’s details', async ({ page }) => {
  const make = uniq('Edit');
  const crane = await seedCrane(page, { make, model: 'E1', capacity: '10t' });
  await page.goto('/');
  await chooseMake(page, make);
  await page
    .locator(`.model-item[data-filename="${crane.id}"]`)
    .getByRole('button', { name: 'Edit metadata' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Edit specification' });
  await dialog.getByLabel('Rated capacity').fill('20t');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.model-item').filter({ hasText: '20t' })).toBeVisible();
});

test('the bin deletes a crane after confirming', async ({ page }) => {
  const make = uniq('Gone');
  const crane = await seedCrane(page, { make });
  await page.goto('/');
  await chooseMake(page, make);
  const row = page.locator(`.model-item[data-filename="${crane.id}"]`);
  await row.getByRole('button', { name: 'Delete specification' }).click();
  await page
    .getByRole('dialog', { name: 'Confirm deletion' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(row).toHaveCount(0);
  expect((await allCranes(page)).some((c) => c.id === crane.id)).toBe(false);
});

test('a long make renders in batches as the list scrolls', async ({ page }) => {
  test.setTimeout(90_000);
  const make = uniq('Many');
  for (let i = 0; i < 75; i += 1) await seedCrane(page, { make, model: `V${i}` });
  await page.goto('/');
  await chooseMake(page, make);
  const rows = page.locator('.model-item');
  await expect(rows.first()).toBeVisible();
  const first = await rows.count();
  expect(first).toBeGreaterThan(0);
  expect(first).toBeLessThan(75);
  await expect(async () => {
    await page.locator('#model-list').evaluate((el) => el.scrollTo(0, el.scrollHeight));
    expect(await rows.count()).toBe(75);
  }).toPass();
});

test('a type group collapses and expands', async ({ page }) => {
  const make = uniq('Fold');
  await seedCrane(page, { make, type: 'Crawler', model: 'C1' });
  await seedCrane(page, { make, type: 'Mobile', model: 'M1' });
  await page.goto('/');
  await chooseMake(page, make);
  const group = page.locator('.type-group').filter({ hasText: 'Crawler' });
  await group.locator('.type-header').click();
  await expect(group).toHaveClass(/is-collapsed/);
  await expect(page.locator('.model-item').filter({ hasText: 'C1' })).toHaveCount(0);
  await group.locator('.type-header').click();
  await expect(page.locator('.model-item').filter({ hasText: 'C1' })).toBeVisible();
});

test('search keeps the makes with a match, and jumps to a make it names', async ({ page }) => {
  const a = uniq('Searcha');
  const b = uniq('Searchb');
  await seedCrane(page, { make: a, model: 'SA1', capacity: '777t' });
  await seedCrane(page, { make: b, model: 'JB1', capacity: '1t' });
  await page.goto('/');
  const search = page.getByRole('searchbox', { name: 'Filter the sidebar list' });
  await search.fill('777t');
  await expect(page.locator(`.make-item[data-make="${a}"]`)).toBeVisible();
  await expect(page.locator(`.make-item[data-make="${b}"]`)).toHaveCount(0);
  await search.fill(b.toLowerCase());
  await expect(page.locator(`.make-item[data-make="${b}"]`)).toHaveClass(/is-active/);
  await expect(page.locator(`.make-item[data-make="${a}"]`)).toHaveCount(0);
  await expect(page.locator('.model-item').filter({ hasText: 'JB1' })).toBeVisible();
});

test('models sort naturally, not letter by letter', async ({ page }) => {
  const make = uniq('Sort');
  for (const model of ['LTM11200-9.1', 'LTM1300-6.2', 'LTM1750-9.1'])
    await seedCrane(page, { make, model });
  await page.goto('/');
  await chooseMake(page, make);
  const names = await page.locator('.model-item__name').allInnerTexts();
  expect(names.map((n) => n.split('\n')[0]?.trim())).toEqual([
    'LTM1300-6.2',
    'LTM1750-9.1',
    'LTM11200-9.1',
  ]);
});
