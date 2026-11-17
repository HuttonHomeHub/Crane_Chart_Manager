// PDF.js, loaded on first use (it is most of the code) with its worker served from this
// app's own origin (the CSP allows only same-origin workers). The one place that imports
// pdfjs-dist, so tests can stand it in.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type * as PdfJs from 'pdfjs-dist';
import type { TextPiece } from './pdf.ts';

let pdfjs: Promise<typeof PdfJs> | undefined;
function library() {
  pdfjs ??= import('pdfjs-dist').then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = workerUrl;
    return lib;
  });
  return pdfjs;
}

export interface PdfPage {
  /** Size at scale 1. */
  size: { width: number; height: number };
  /** Draws the page onto `canvas` at `scale`; returns the viewport transform. */
  render: (
    canvas: HTMLCanvasElement,
    scale: number,
    dpr: number
  ) => { promise: Promise<void>; cancel: () => void; transform: number[] };
  text: () => Promise<TextPiece[]>;
}

export interface PdfDoc {
  pageCount: number;
  page: (n: number) => Promise<PdfPage>;
  destroy: () => void;
}

export interface PdfLoad {
  promise: Promise<PdfDoc>;
  cancel: () => void;
}

/** Starts loading the PDF at `url`; `cancel` stops it (and frees it if it loaded). */
export function loadPdf(url: string): PdfLoad {
  let cancelled = false;
  let destroy = () => {
    cancelled = true;
  };
  const promise = library().then(async ({ getDocument }) => {
    if (cancelled) throw new Error('cancelled');
    const task = getDocument({ url });
    destroy = () => void task.destroy();
    const doc = await task.promise;
    return {
      pageCount: doc.numPages,
      destroy: () => destroy(),
      page: async (n) => {
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        return {
          size: { width: base.width, height: base.height },
          render: (canvas, scale, dpr) => {
            const viewport = page.getViewport({ scale });
            canvas.width = Math.floor(viewport.width * dpr);
            canvas.height = Math.floor(viewport.height * dpr);
            canvas.style.width = `${Math.floor(viewport.width)}px`;
            canvas.style.height = `${Math.floor(viewport.height)}px`;
            const task = page.render({
              canvas,
              viewport,
              ...(dpr === 1 ? {} : { transform: [dpr, 0, 0, dpr, 0, 0] }),
            });
            return {
              promise: task.promise,
              cancel: () => task.cancel(),
              transform: viewport.transform,
            };
          },
          text: async () => {
            const content = await page.getTextContent();
            return content.items.flatMap((item) =>
              'str' in item && item.str
                ? [{ str: item.str, transform: item.transform as number[], width: item.width }]
                : []
            );
          },
        };
      },
    } satisfies PdfDoc;
  });
  return { promise, cancel: () => destroy() };
}
