import { Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AppBar, ConfirmDialog, useToast } from '@hhh/ui';
import type { Crane } from '../shared/api.ts';
import { CraneIcon } from './components/CraneIcon.tsx';
import { EmptyState } from './components/EmptyState.tsx';
import { InfoBar } from './components/InfoBar.tsx';
import { SettingsDialog } from './components/SettingsDialog.tsx';
import { Sidebar, makeForQuery } from './components/Sidebar.tsx';
import { useCatalogue } from './hooks/useCatalogue.ts';
import { useCraneActions } from './hooks/useCraneActions.ts';
import { useMediaQuery } from './hooks/useMediaQuery.ts';
import { useAppVersion } from './hooks/useSettings.ts';
import { groupCatalogue } from './lib/catalogue.ts';

/** Below this width the sidebar is a drawer (1.x's --bp-tablet). */
export const DRAWER_QUERY = '(max-width: 900px)';

/** The crane to focus after `gone` is deleted: the next row in its type, else the previous. */
export function neighbourOf(cranes: Crane[], gone: Crane): string | undefined {
  const same = cranes.filter((c) => c.make === gone.make);
  const inType = same.filter((c) => c.type === gone.type);
  const pick = (list: Crane[]) => {
    const i = list.findIndex((c) => c.id === gone.id);
    return (list[i + 1] ?? list[i - 1])?.id;
  };
  return pick(inType) ?? pick(same);
}

export function App() {
  const version = useAppVersion();
  const toast = useToast();
  const { cranes, facets, loading, error, reload } = useCatalogue();
  const { deleteCrane } = useCraneActions();
  const groups = useMemo(() => groupCatalogue(cranes), [cranes]);

  const [query, setQuery] = useState('');
  const [chosenMake, setChosenMake] = useState<string | undefined>();
  const [currentId, setCurrentId] = useState<string | undefined>();
  const [focusId, setFocusId] = useState<string | undefined>();
  const [drawer, setDrawer] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Crane | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const narrow = useMediaQuery(DRAWER_QUERY);
  const drawerOpen = narrow && drawer;

  // The make shown: the one chosen while it exists and matches the search, else the
  // best match (as 1.x's jump-to-make).
  const make = makeForQuery(groups, query, chosenMake);
  const current = cranes.find((c) => c.id === currentId);

  useEffect(() => {
    document.title = current ? `${current.make} ${current.model} · Crane Charts` : 'Crane Charts';
  }, [current]);

  useEffect(() => {
    if (error) toast(`Could not load documents: ${error}`, 'error');
  }, [error, toast]);

  const open = (crane: Crane) => {
    setCurrentId(crane.id);
    setDrawer(false);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteCrane(pendingDelete.id);
      setFocusId(neighbourOf(cranes, pendingDelete));
      if (pendingDelete.id === currentId) setCurrentId(undefined);
      setPendingDelete(null);
      toast('Specification deleted', 'success');
      await reload();
    } catch (err) {
      setDeleteError((err as Error).message || 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  const deleteName = pendingDelete
    ? `${pendingDelete.model || pendingDelete.name}${pendingDelete.capacity ? ` (${pendingDelete.capacity})` : ''}`
    : '';

  return (
    <div className="app">
      <AppBar
        appName="Crane Charts"
        version={version}
        icon={<CraneIcon />}
        menuOpen={drawerOpen}
        {...(narrow ? { onMenu: () => setDrawer((d) => !d) } : {})}
        onSettings={() => setSettingsOpen(true)}
        search={
          <label className="app-search" role="search">
            <Search size={16} aria-hidden />
            <input
              id="search-input"
              type="search"
              placeholder="Filter the list…"
              aria-label="Filter the sidebar list"
              autoComplete="off"
              value={query}
              onChange={(e) => {
                const q = e.target.value;
                setQuery(q);
                setChosenMake(makeForQuery(groups, q, make));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') e.currentTarget.blur();
              }}
            />
          </label>
        }
      />
      <div className="layout">
        <Sidebar
          groups={groups}
          loading={loading}
          query={query}
          make={make}
          onSelectMake={setChosenMake}
          currentId={currentId}
          focusId={focusId}
          onOpen={open}
          onDelete={(crane) => {
            setDeleteError(null);
            setPendingDelete(crane);
          }}
          open={drawerOpen}
        />
        {drawerOpen ? (
          <div className="sidebar-scrim" aria-hidden onClick={() => setDrawer(false)} />
        ) : null}
        <main className="viewer" inert={drawerOpen}>
          {current ? <InfoBar crane={current} /> : <EmptyState hasCranes={cranes.length > 0} />}
        </main>
      </div>
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        makes={facets.makes}
        onChanged={reload}
      />
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Confirm deletion"
        message={`Delete “${deleteName}”? This cannot be undone.`}
        confirmLabel="Delete"
        danger
        busy={deleting}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
