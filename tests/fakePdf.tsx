// A stand-in for src/lib/pdfjs.ts in jsdom tests: documents whose pages carry given
// lines of text, which "render" instantly. Register text with `fakePdfs.set(url, pages)`.
import type { PdfDoc, PdfLoad, PdfPage } from '../src/lib/pdfjs.ts';

export const PAGE = { width: 600, height: 800 };

/** url → each page's lines of text. A url not here fails to load. */
export const fakePdfs = new Map<string, string[][]>();
export const renders: Array<{ url: string; page: number; scale: number }> = [];
export const destroyed: string[] = [];

export function loadPdf(url: string): PdfLoad {
  const pages = fakePdfs.get(url);
  const doc: PdfDoc | undefined = pages && {
    pageCount: pages.length,
    destroy: () => destroyed.push(url),
    page: async (n): Promise<PdfPage> => ({
      size: PAGE,
      render: (_canvas, scale) => {
        renders.push({ url, page: n, scale });
        return {
          promise: Promise.resolve(),
          cancel: () => undefined,
          transform: [scale, 0, 0, -scale, 0, PAGE.height * scale],
        };
      },
      text: async () =>
        (pages[n - 1] ?? []).map((str, i) => ({
          str,
          transform: [12, 0, 0, 12, 50, 700 - i * 20],
          width: str.length * 6,
        })),
    }),
  };
  return {
    promise: doc ? Promise.resolve(doc) : Promise.reject(new Error('Missing PDF')),
    cancel: () => undefined,
  };
}
