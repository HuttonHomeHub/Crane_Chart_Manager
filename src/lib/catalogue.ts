// Catalogue rules carried over from 1.x's main.js: how cranes sort, group and match a
// search, and how a dropped file's name becomes a crane's details.
import type { Crane } from '../../shared/api.ts';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Natural order, ignoring case and accents: LTM1300 < LTM1750 < LTM11200. */
export const naturalCompare = (a: string, b: string) => collator.compare(a, b);

export const makeOf = (c: Crane) => c.make || 'Unknown';
export const typeOf = (c: Crane) => c.type || 'Other';
export const modelOf = (c: Crane) => c.model || 'Unknown';

/** The text a search looks in: details plus every file label, lower-cased. */
export function searchText(c: Crane): string {
  return [c.make, c.type, c.model, c.capacity, ...c.files.map((f) => f.label)]
    .join(' ')
    .toLowerCase();
}

export interface TypeGroup {
  type: string;
  cranes: Crane[];
}

export interface MakeGroup {
  make: string;
  cranes: Crane[];
  types: TypeGroup[];
  /** Every crane's searchText, joined. */
  text: string;
}

/** Makes, each with its types, each with its models, all in natural order. */
export function groupCatalogue(cranes: Crane[]): MakeGroup[] {
  const makes = new Map<string, Crane[]>();
  for (const c of cranes) makes.set(makeOf(c), [...(makes.get(makeOf(c)) ?? []), c]);
  return [...makes.entries()]
    .sort(([a], [b]) => naturalCompare(a, b))
    .map(([make, list]) => {
      const types = new Map<string, Crane[]>();
      for (const c of list) types.set(typeOf(c), [...(types.get(typeOf(c)) ?? []), c]);
      return {
        make,
        cranes: list,
        types: [...types.entries()]
          .sort(([a], [b]) => naturalCompare(a, b))
          .map(([type, group]) => ({
            type,
            cranes: [...group].sort((a, b) => naturalCompare(modelOf(a), modelOf(b))),
          })),
        text: list.map(searchText).join(' '),
      };
    });
}

/** The first number in a capacity ("1 200 t" → 1200, "250t" → 250), or NaN. */
export function parseCapacity(capacity: string): number {
  const m = /\d+(?:\.\d+)?/.exec(capacity.replace(/[,\s]/g, ''));
  return m ? Number(m[0]) : Number.NaN;
}

/** A minimum-capacity query (">=150", ">150", "≥150", "150t+", "150+") → 150; else null. */
export function minCapacity(query: string): number | null {
  const m =
    /^\s*(?:>=|>|≥)\s*(\d+(?:\.\d+)?)/.exec(query) ??
    /^\s*(\d+(?:\.\d+)?)\s*t?\s*\+\s*$/i.exec(query);
  return m?.[1] ? Number(m[1]) : null;
}

export const PALETTE_LIMIT = 60;

/**
 * The command palette's matches: every crane at or above a minimum capacity (smallest
 * first), or the cranes containing every word of the query; at most 60.
 */
export function paletteMatches(cranes: Crane[], query: string): Crane[] {
  const q = query.trim().toLowerCase();
  if (!q) return cranes.slice(0, PALETTE_LIMIT);
  const min = minCapacity(q);
  if (min !== null) {
    return cranes
      .map((c) => ({ c, cap: parseCapacity(c.capacity) }))
      .filter((x) => x.cap >= min)
      .sort((a, b) => a.cap - b.cap)
      .slice(0, PALETTE_LIMIT)
      .map((x) => x.c);
  }
  const terms = q.split(/\s+/);
  return cranes
    .filter((c) => {
      const text = searchText(c);
      return terms.every((t) => text.includes(t));
    })
    .slice(0, PALETTE_LIMIT);
}

/**
 * Details from a file name: "Liebherr LTM1100 (Load Chart).pdf" → make Liebherr, model
 * LTM1100, label "Load Chart". Only a parenthesis at the very end is a label; type and
 * capacity are never guessed.
 */
export function parseFilename(name: string): { make: string; model: string; label: string } {
  let base = name.replace(/\.pdf$/i, '').trim();
  let label = '';
  const paren = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(base);
  if (paren) {
    base = (paren[1] ?? '').trim();
    label = (paren[2] ?? '').trim();
  }
  const [make = '', ...rest] = base.split(/\s+/).filter(Boolean);
  return { make, model: rest.join(' '), label };
}

/** A PDF by its name or type. */
export const isPdf = (file: File) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
