import { useCallback, useSyncExternalStore } from 'react';

const PREFIX = '#crane/';

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

/** The crane id in a #crane/<id> link, or undefined. */
export function craneIdFromHash(hash: string): string | undefined {
  if (!hash.startsWith(PREFIX) || hash.length === PREFIX.length) return undefined;
  try {
    return decodeURIComponent(hash.slice(PREFIX.length));
  } catch {
    return undefined;
  }
}

/**
 * The open crane lives in the address: #crane/<id>. Opening one adds a history entry,
 * so Back and Forward move between cranes, and a link opens it on load.
 */
export function useHashCrane(): [string | undefined, (id: string) => void] {
  const hash = useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => ''
  );
  const open = useCallback((id: string) => {
    const next = `${PREFIX}${encodeURIComponent(id)}`;
    if (window.location.hash !== next) window.location.hash = next;
  }, []);
  return [craneIdFromHash(hash), open];
}
