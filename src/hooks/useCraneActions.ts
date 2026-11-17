import { useCallback } from 'react';
import { apiFetch } from '@hhh/ui';

/** Changes to a crane from the sidebar. The caller reloads the catalogue afterwards. */
export function useCraneActions() {
  const deleteCrane = useCallback(async (id: string) => {
    await apiFetch(`/api/delete/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }, []);
  return { deleteCrane };
}
