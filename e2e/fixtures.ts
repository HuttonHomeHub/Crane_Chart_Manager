// Helpers for the end-to-end tests: real PDFs with real text (so PDF.js and find are
// exercised), API seeding with the CSRF header, and names unique to each test (the tests
// share one server, so each makes its own cranes).
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type { Crane, CraneReply } from '../shared/api.ts';

let counter = 0;
/** A name no other test uses, e.g. "Zx3k1Make". */
export function uniq(prefix: string): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter}`;
}

const escapePdf = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);

/** A valid PDF whose pages carry these lines of text (one text item per line). */
export function makePdf(pages: string[][]): Buffer {
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const catalog = add('');
  const pagesObj = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids: number[] = [];
  for (const lines of pages) {
    const ops = lines
      .map((line, i) => `BT /F1 14 Tf 72 ${720 - i * 24} Td (${escapePdf(line)}) Tj ET`)
      .join('\n');
    const content = add(
      `<< /Length ${Buffer.byteLength(ops, 'latin1')} >>\nstream\n${ops}\nendstream`
    );
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] ` +
          `/Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`
      )
    );
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] =
    `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** A one-page PDF saying what it is. */
export const simplePdf = (text = 'Load chart') => makePdf([[text]]);

/** The CSRF token the app issues (any GET sets the cookie). */
async function csrf(request: APIRequestContext): Promise<string> {
  await request.get('/api/facets');
  const state = await request.storageState();
  const cookie = state.cookies.find((c) => c.name === 'hhh_csrf');
  if (!cookie) throw new Error('no CSRF cookie');
  return cookie.value;
}

export interface Details {
  make: string;
  type?: string;
  model?: string;
  capacity?: string;
  label?: string;
}

/** Creates a crane through the API (as the page's own requests would). */
export async function seedCrane(page: Page, details: Details, pdf = simplePdf()): Promise<Crane> {
  const token = await csrf(page.request);
  const res = await page.request.post('/api/upload', {
    headers: { 'X-CSRF-Token': token },
    multipart: {
      file: { name: 'chart.pdf', mimeType: 'application/pdf', buffer: pdf },
      make: details.make,
      type: details.type ?? 'Mobile',
      model: details.model ?? 'M1',
      capacity: details.capacity ?? '100t',
      ...(details.label ? { label: details.label } : {}),
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as CraneReply;
}

/** Adds a file to a crane through the API. */
export async function seedFile(page: Page, craneId: string, label: string, pdf = simplePdf(label)) {
  const token = await csrf(page.request);
  const res = await page.request.post(`/api/cranes/${encodeURIComponent(craneId)}/files`, {
    headers: { 'X-CSRF-Token': token },
    multipart: { file: { name: `${label}.pdf`, mimeType: 'application/pdf', buffer: pdf }, label },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as CraneReply;
}

/** Every crane on the server. */
export async function allCranes(page: Page): Promise<Crane[]> {
  const res = await page.request.get('/api/pdfs');
  return ((await res.json()) as { items: Crane[] }).items;
}

/** Selects a make in the sidebar. */
export async function chooseMake(page: Page, make: string) {
  await page.locator(`.make-item[data-make="${make}"]`).click();
}
