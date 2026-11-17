import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@hhh/ui';
import type { Crane, CranePage, Facets } from '../../shared/api.ts';

export const PAGE_SIZE = 200;

/** Every crane, 200 at a time; `onPage` sees the list so far after each page. */
export async function fetchCatalogue(onPage?: (soFar: Crane[]) => void): Promise<Crane[]> {
  let all: Crane[] = [];
  let after: string | null = '';
  while (after !== null) {
    const query = `limit=${PAGE_SIZE}${after ? `&after=${encodeURIComponent(after)}` : ''}`;
    const page: CranePage = await apiFetch<CranePage>(`/api/pdfs?${query}`);
    all = [...all, ...page.items];
    after = page.next_cursor;
    if (after !== null) onPage?.(all);
  }
  return all;
}

/**
 * Every crane, and the manufacturers and types in use (autocomplete, the merge tool).
 * `reload` fetches both again, repainting as pages arrive; a later load wins over an
 * earlier one still running.
 */
export function useCatalogue() {
  const [cranes, setCranes] = useState<Crane[]>([]);
  const [facets, setFacets] = useState<Facets>({ makes: [], types: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const load = useCallback((progressive: boolean) => {
    const mine = ++generation.current;
    const current = () => mine === generation.current;
    const catalogue = fetchCatalogue(
      progressive
        ? (soFar) => {
            if (current()) setCranes(soFar);
          }
        : undefined
    ).then(
      (all) => {
        if (!current()) return;
        setCranes(all);
        setError(null);
      },
      (err: unknown) => {
        if (!current()) return;
        setCranes([]);
        setError((err as Error).message || 'Failed to load documents');
      }
    );
    // Autocomplete only: a failure keeps the previous lists.
    const lists = apiFetch<Facets>('/api/facets').then(
      (next) => {
        if (current()) setFacets(next);
      },
      () => undefined
    );
    return Promise.all([catalogue, lists]).then(() => {
      if (current()) setLoading(false);
    });
  }, []);

  // The first load; state is only set when answers arrive.
  useEffect(() => {
    void load(false);
  }, [load]);

  const reload = useCallback(() => load(true), [load]);
  return { cranes, facets, loading, error, reload };
}
