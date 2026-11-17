import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@hhh/ui';
import type {
  BackupsReply,
  InstanceInfoReply,
  MergeReply,
  RestoreReply,
} from '../../shared/api.ts';

// The Settings panel's data: how this instance is set up (/api/info) and its backups
// (/api/backup). Loaded when the panel opens; every action reloads both.
export function useSettings(open: boolean) {
  const [info, setInfo] = useState<InstanceInfoReply | null>(null);
  const [backups, setBackups] = useState<BackupsReply | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (isCurrent: () => boolean) =>
      Promise.all([
        apiFetch<InstanceInfoReply>('/api/info'),
        apiFetch<BackupsReply>('/api/backup'),
      ]).then(
        ([nextInfo, nextBackups]) => {
          if (!isCurrent()) return;
          setInfo(nextInfo);
          setBackups(nextBackups);
          setError(null);
        },
        (err: unknown) => {
          if (isCurrent()) setError((err as Error).message);
        }
      ),
    []
  );
  const refresh = useCallback(() => load(() => true), [load]);

  useEffect(() => {
    if (!open) return;
    let current = true;
    void load(() => current);
    return () => {
      current = false;
    };
  }, [open, load]);

  const backupNow = useCallback(async () => {
    await apiFetch('/api/backup', { method: 'POST' });
    await refresh();
  }, [refresh]);

  const restore = useCallback(
    async (source: string | File) => {
      let body: FormData | { name: string };
      if (typeof source === 'string') body = { name: source };
      else {
        body = new FormData();
        body.append('file', source);
      }
      const result = await apiFetch<RestoreReply>('/api/backup/restore', {
        method: 'POST',
        body,
      });
      await refresh();
      return result;
    },
    [refresh]
  );

  const mergeMakes = useCallback(async (from: string, into: string) => {
    return apiFetch<MergeReply>('/api/merge-make', { method: 'POST', body: { from, into } });
  }, []);

  return { info, backups, error, backupNow, restore, mergeMakes };
}

/** The running version for the app bar (empty until it loads). */
export function useAppVersion() {
  const [version, setVersion] = useState('');
  useEffect(() => {
    apiFetch<{ version: string }>('/version')
      .then((v) => setVersion(v.version))
      .catch(() => setVersion(''));
  }, []);
  return version;
}
