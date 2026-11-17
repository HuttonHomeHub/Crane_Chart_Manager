// The viewer's arithmetic, carried over from 1.x: fitting a page, zoom steps, and where a
// find match sits on the page.

export type FitMode = 'page' | 'width' | 'custom';

export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

/** The scale for a page of `page` size in a well of `avail` size. */
export function scaleFor(
  mode: FitMode,
  zoom: number,
  page: { width: number; height: number },
  avail: { width: number; height: number }
): number {
  if (mode === 'custom' || page.width <= 0 || page.height <= 0) return zoom;
  const width = avail.width / page.width;
  if (mode === 'width') return width;
  return Math.min(width, avail.height / page.height);
}

/** The next zoom step in `direction` from `zoom` (snapped to the nearest step first). */
export function zoomStep(zoom: number, direction: 1 | -1): number {
  let nearest = 0;
  ZOOM_STEPS.forEach((s, i) => {
    if (Math.abs(s - zoom) < Math.abs((ZOOM_STEPS[nearest] ?? 1) - zoom)) nearest = i;
  });
  const i = Math.min(ZOOM_STEPS.length - 1, Math.max(0, nearest + direction));
  return ZOOM_STEPS[i] ?? 1;
}

/** The readout's cycle: fit page → fit width → 100% → fit page. */
export function nextFit(mode: FitMode): { mode: FitMode; zoom?: number } {
  if (mode === 'page') return { mode: 'width' };
  if (mode === 'width') return { mode: 'custom', zoom: 1 };
  return { mode: 'page' };
}

/** One piece of a page's text, as PDF.js reports it. */
export interface TextPiece {
  str: string;
  /** [a, b, c, d, e, f] in PDF space. */
  transform: number[];
  width: number;
}

export interface Match {
  page: number;
  piece: TextPiece;
}

/**
 * Every piece containing `query` (case-insensitive), page by page. A match never spans
 * two pieces, as in 1.x.
 */
export function findMatches(pages: Map<number, TextPiece[]>, query: string): Match[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: Match[] = [];
  for (const [page, pieces] of [...pages.entries()].sort(([a], [b]) => a - b)) {
    for (const piece of pieces) if (piece.str.toLowerCase().includes(q)) out.push({ page, piece });
  }
  return out;
}

/** The first match on or after `page`, else the first; -1 when there are none. */
export function firstMatchFrom(matches: Match[], page: number): number {
  if (matches.length === 0) return -1;
  const i = matches.findIndex((m) => m.page >= page);
  return i >= 0 ? i : 0;
}

/**
 * A piece's box as percentages of the page: its transform composed with the viewport's
 * (`vt`, from PDF space to the canvas), so it stays right however the canvas is scaled.
 */
export function highlightBox(
  piece: TextPiece,
  vt: number[],
  scale: number,
  size: { width: number; height: number }
) {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = piece.transform;
  const [va = 1, vb = 0, vc = 0, vd = 1, ve = 0, vf = 0] = vt;
  // m = vt × piece.transform
  const m = [
    va * a + vc * b,
    vb * a + vd * b,
    va * c + vc * d,
    vb * c + vd * d,
    va * e + vc * f + ve,
    vb * e + vd * f + vf,
  ];
  const height = Math.hypot(m[2] ?? 0, m[3] ?? 0);
  const left = m[4] ?? 0;
  const top = (m[5] ?? 0) - height;
  const width = piece.width * scale;
  const pct = (n: number, of: number) => `${(n / of) * 100}%`;
  return {
    left: pct(left, size.width),
    top: pct(top, size.height),
    width: pct(width, size.width),
    height: pct(height, size.height),
  };
}
