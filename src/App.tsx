import { Search, Upload } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AppBar, Button, ConfirmDialog, useToast } from '@hhh/ui';
import type { Crane } from '../shared/api.ts';
import { BulkImport } from './components/BulkImport.tsx';
import { CraneIcon } from './components/CraneIcon.tsx';
import { DropZone } from './components/DropZone.tsx';
import { EmptyState } from './components/EmptyState.tsx';
import { InfoBar } from './components/InfoBar.tsx';
import { MetadataDialog, type MetaRequest, type MetaResult } from './components/MetadataDialog.tsx';
import { SettingsDialog } from './components/SettingsDialog.tsx';
import { Viewer } from './components/Viewer.tsx';
import { Sidebar, makeForQuery } from './components/Sidebar.tsx';
import { useCatalogue } from './hooks/useCatalogue.ts';
import { useCraneActions } from './hooks/useCraneActions.ts';
import { useMediaQuery } from './hooks/useMediaQuery.ts';
import { useAppVersion } from './hooks/useSettings.ts';
import { useHashCrane } from './hooks/useHashCrane.ts';
import { groupCatalogue, isPdf } from './lib/catalogue.ts';
import { plural } from './lib/format.ts';

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
  const { cranes, facets, loading, error, reload, patch } = useCatalogue();
  const { deleteCrane } = useCraneActions();
  const groups = useMemo(() => groupCatalogue(cranes), [cranes]);

  const [query, setQuery] = useState('');
  const [chosenMake, setChosenMake] = useState<string | undefined>();
  const [currentId, openCrane] = useHashCrane();
  const [seenId, setSeenId] = useState<string | undefined>();
  const [focusId, setFocusId] = useState<string | undefined>();
  const [drawer, setDrawer] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Crane | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // The upload/edit/add-file dialog (a new key each time, so it opens fresh) and bulk import.
  const [meta, setMeta] = useState<{ key: number; request: MetaRequest } | null>(null);
  const [bulk, setBulk] = useState<{ key: number; files: File[] } | null>(null);

  const narrow = useMediaQuery(DRAWER_QUERY);
  const drawerOpen = narrow && drawer;

  // The make shown: the one chosen while it exists and matches the search, else the
  // best match (as 1.x's jump-to-make).
  const current = cranes.find((c) => c.id === currentId);
  // A crane opened by a link, Back or Forward shows its own make in the sidebar.
  if (current && current.id !== seenId) {
    setSeenId(current.id);
    setChosenMake(current.make);
  }
  const make = makeForQuery(groups, query, chosenMake);

  useEffect(() => {
    document.title = current ? `${current.make} ${current.model} · Crane Charts` : 'Crane Charts';
  }, [current]);

  useEffect(() => {
    if (error) toast(`Could not load documents: ${error}`, 'error');
  }, [error, toast]);

  const open = (crane: Crane) => {
    openCrane(crane.id);
    setDrawer(false);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteCrane(pendingDelete.id);
      setFocusId(neighbourOf(cranes, pendingDelete));
      setPendingDelete(null);
      toast('Specification deleted', 'success');
      await reload();
    } catch (err) {
      setDeleteError((err as Error).message || 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  const startMeta = (request: MetaRequest) => setMeta({ key: Date.now(), request });
  const startBulk = (files: File[]) => {
    setMeta(null);
    setBulk({ key: Date.now(), files });
  };

  /** A drop on the window: several files import in bulk; one PDF uploads, or joins the open crane. */
  const dropped = (files: File[]) => {
    if (files.length > 1) {
      startBulk(files);
      return;
    }
    const [file] = files;
    if (!file) return;
    if (!isPdf(file)) toast('Only PDF files can be uploaded.', 'error');
    else if (current) startMeta({ mode: 'addfile', crane: current, file });
    else startMeta({ mode: 'upload', file });
  };

  const saved = (result: MetaResult) => {
    setMeta(null);
    if (result.mode === 'upload') toast('Specification uploaded', 'success');
    else if (result.mode === 'addfile') {
      toast('File added', 'success');
      patch(result.crane);
    } else {
      toast(result.crane.renamed ? 'Saved & renamed' : 'Saved', 'success');
      // A new slug is a new address: follow the crane if it was open.
      if (result.crane.renamed && current?.id === result.oldId) openCrane(result.crane.id);
    }
    void reload();
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
        actions={
          <Button
            id="upload-trigger"
            variant="primary"
            icon={<Upload size={16} aria-hidden />}
            onClick={() => startMeta({ mode: 'upload' })}
          >
            Upload
          </Button>
        }
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
          currentId={current?.id}
          revealId={current?.id}
          focusId={focusId}
          onOpen={open}
          onEdit={(crane) => startMeta({ mode: 'edit', crane })}
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
          {current ? (
            <>
              <InfoBar crane={current} />
              <Viewer
                key={current.id}
                crane={current}
                notify={toast}
                onAddFile={() => startMeta({ mode: 'addfile', crane: current })}
                onChanged={(updated) => {
                  patch(updated);
                  void reload();
                }}
                onDeleted={() => {
                  setFocusId(neighbourOf(cranes, current));
                  void reload();
                }}
              />
            </>
          ) : (
            <EmptyState
              hasCranes={cranes.length > 0}
              onUpload={() => startMeta({ mode: 'upload' })}
            />
          )}
        </main>
      </div>
      <DropZone onDrop={dropped} />
      {meta ? (
        <MetadataDialog
          key={meta.key}
          request={meta.request}
          facets={facets}
          onClose={() => setMeta(null)}
          onSaved={saved}
          onBulk={startBulk}
          onSwitch={startMeta}
        />
      ) : null}
      {bulk ? (
        <BulkImport
          key={bulk.key}
          files={bulk.files}
          facets={facets}
          onClose={() => {
            setBulk(null);
            void reload();
          }}
          onImported={(done, failed) => {
            void reload();
            if (!failed) {
              setBulk(null);
              toast(`Imported ${plural(done, 'crane')}`, 'success');
            }
          }}
        />
      ) : null}
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
