import { useCallback } from 'react';
import { apiFetch } from '@hhh/ui';
import type { CraneReply, DeleteFileReply } from '../../shared/api.ts';

const filePath = (craneId: string, fileId: number) =>
  `/api/cranes/${encodeURIComponent(craneId)}/files/${fileId}`;

/** Changes to one crane's files; each returns the crane as the server now has it. */
export function useFileActions() {
  const setPrimary = useCallback(
    (craneId: string, fileId: number) =>
      apiFetch<CraneReply>(`/api/cranes/${encodeURIComponent(craneId)}/primary`, {
        method: 'PUT',
        body: { file_id: fileId },
      }),
    []
  );
  const rename = useCallback(
    (craneId: string, fileId: number, label: string) =>
      apiFetch<CraneReply>(filePath(craneId, fileId), { method: 'PATCH', body: { label } }),
    []
  );
  const remove = useCallback(
    (craneId: string, fileId: number) =>
      apiFetch<DeleteFileReply>(filePath(craneId, fileId), { method: 'DELETE' }),
    []
  );
  return { setPrimary, rename, remove };
}
