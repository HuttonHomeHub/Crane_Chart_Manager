import { useCallback } from 'react';
import { apiFetch } from '@hhh/ui';
import type { CraneReply, MetadataReply } from '../../shared/api.ts';
import { upload } from '../lib/upload.ts';

export interface CraneDetails {
  make: string;
  type: string;
  model: string;
  capacity: string;
}

/** Changes to cranes. The caller reloads the catalogue afterwards. */
export function useCraneActions() {
  const deleteCrane = useCallback(async (id: string) => {
    await apiFetch(`/api/delete/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }, []);

  /** A new crane from its first PDF (and that file's label, from the bulk importer). */
  const createCrane = useCallback(
    (details: CraneDetails, file: File, label = '', onProgress?: (pct: number) => void) => {
      const form = new FormData();
      form.append('file', file);
      for (const [k, v] of Object.entries(details)) form.append(k, v);
      if (label) form.append('label', label);
      return upload<CraneReply>('/api/upload', form, onProgress);
    },
    []
  );

  /** Another PDF for an existing crane. */
  const addFile = useCallback(
    (craneId: string, file: File, label = '', onProgress?: (pct: number) => void) => {
      const form = new FormData();
      form.append('file', file);
      if (label) form.append('label', label);
      return upload<CraneReply>(
        `/api/cranes/${encodeURIComponent(craneId)}/files`,
        form,
        onProgress
      );
    },
    []
  );

  const editCrane = useCallback(
    (id: string, details: CraneDetails) =>
      apiFetch<MetadataReply>(`/api/metadata/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: details,
      }),
    []
  );

  return { deleteCrane, createCrane, addFile, editCrane };
}
