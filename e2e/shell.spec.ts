import { expect, test } from '@playwright/test';
import { makePdf, seedCrane, uniq } from './fixtures.ts';

test('the app loads with its title, version and upload button', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Crane Charts');
  await expect(page.getByRole('button', { name: 'Upload', exact: true })).toBeVisible();
  const version = (await (await page.request.get('/version')).json()) as { version: string };
  expect(version.version).toBe('e2e');
  await expect(page.locator('.hhh-version')).toHaveText('e2e');
});

test('health answers in the shared standard’s shape', async ({ page }) => {
  const res = await page.request.get('/health');
  expect(res.ok()).toBe(true);
  expect(await res.json()).toEqual({ status: 'ok', version: 'e2e' });
});

test('every script tag carries data-cfasync="false" (Cloudflare Rocket Loader)', async ({
  page,
}) => {
  const html = await (await page.request.get('/')).text();
  const tags = html.match(/<script [^>]*>/g) ?? [];
  expect(tags.length).toBeGreaterThan(1);
  for (const tag of tags) expect(tag).toContain('data-cfasync="false"');
  const res = await page.request.get('/');
  expect(res.headers()['content-security-policy']).toContain("default-src 'self'");
});

test('a real PDF renders with no console errors or CSP violations', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    // The test server is plain HTTP on a private host name, so Chrome ignores the
    // Cross-Origin-Opener-Policy header and says so. Live is HTTPS, where it applies.
    const coopOverHttp = m
      .text()
      .startsWith('The Cross-Origin-Opener-Policy header has been ignored');
    if (m.type() === 'error' && !coopOverHttp) problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(e.message));
  const crane = await seedCrane(
    page,
    { make: uniq('Render'), model: 'R1' },
    makePdf([['Page one'], ['Page two']])
  );
  await page.goto(`/#crane/${encodeURIComponent(crane.id)}`);
  await expect(page.locator('#page-total')).toHaveText('2');
  await expect(page.locator('#zoom-level')).toHaveText(/\d+%/);
  // The canvas has been painted (not all white).
  const painted = await page.locator('#pdf-canvas').evaluate((c) => {
    const canvas = c as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < data.length; i += 4) if ((data[i] ?? 255) < 200) return true;
    return false;
  });
  expect(painted).toBe(true);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Page' })).toHaveValue('2');
  expect(problems).toEqual([]);
});
