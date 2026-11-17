import { describe, expect, it } from 'vitest';
import {
  findMatches,
  firstMatchFrom,
  highlightBox,
  nextFit,
  scaleFor,
  zoomStep,
  type TextPiece,
} from '../src/lib/pdf.ts';
import { craneIdFromHash } from '../src/hooks/useHashCrane.ts';

const page = { width: 600, height: 800 };

describe('viewer arithmetic', () => {
  it('fits a page by width, by whole page, or uses the zoom', () => {
    expect(scaleFor('width', 1, page, { width: 1200, height: 800 })).toBe(2);
    expect(scaleFor('page', 1, page, { width: 1200, height: 800 })).toBe(1);
    expect(scaleFor('custom', 1.5, page, { width: 1200, height: 800 })).toBe(1.5);
    expect(scaleFor('page', 1.5, { width: 0, height: 0 }, { width: 1, height: 1 })).toBe(1.5);
  });

  it('steps zoom along the list, snapping first and stopping at the ends', () => {
    expect(zoomStep(1, 1)).toBe(1.25);
    expect(zoomStep(1.37, -1)).toBe(1);
    expect(zoomStep(0.25, -1)).toBe(0.25);
    expect(zoomStep(4, 1)).toBe(4);
  });

  it('cycles the readout: page, width, 100%', () => {
    expect(nextFit('page')).toEqual({ mode: 'width' });
    expect(nextFit('width')).toEqual({ mode: 'custom', zoom: 1 });
    expect(nextFit('custom')).toEqual({ mode: 'page' });
  });

  it('finds pieces containing the query, page by page', () => {
    const piece = (str: string): TextPiece => ({ str, transform: [1, 0, 0, 1, 0, 0], width: 1 });
    const pages = new Map([
      [2, [piece('250t at 10m'), piece('other')]],
      [1, [piece('Max 250T')]],
    ]);
    const found = findMatches(pages, ' 250t ');
    expect(found.map((m) => m.page)).toEqual([1, 2]);
    expect(findMatches(pages, '')).toEqual([]);
    expect(firstMatchFrom(found, 2)).toBe(1);
    expect(firstMatchFrom(found, 3)).toBe(0);
    expect(firstMatchFrom([], 1)).toBe(-1);
  });

  it('places a highlight in percentages of the page', () => {
    const piece: TextPiece = { str: 'x', transform: [12, 0, 0, 12, 60, 700], width: 120 };
    // Scale 1: the baseline (PDF y=700) is 100px from the top; the 12px box ends there.
    const box = highlightBox(piece, [1, 0, 0, -1, 0, 800], 1, page);
    expect(box).toEqual({ left: '10%', top: '11%', width: '20%', height: '1.5%' });
  });

  it('reads #crane/<id> links', () => {
    expect(craneIdFromHash('#crane/%C3%A9t%C3%A9_x')).toBe('été_x');
    expect(craneIdFromHash('#crane/')).toBeUndefined();
    expect(craneIdFromHash('#other')).toBeUndefined();
    expect(craneIdFromHash('#crane/%E0%A4%A')).toBeUndefined();
  });
});
