import { CheckCircle2, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button, ConfirmDialog, Dialog, TextField } from '@hhh/ui';
import type { Crane, CraneFile } from '../../shared/api.ts';
import { useFileActions } from '../hooks/useFileActions.ts';
import { PdfView, type FindState } from './PdfView.tsx';

export const fileLabel = (f: CraneFile) =>
  f.label || f.original_filename || f.stored_name || 'Document';

export interface ViewerProps {
  crane: Crane;
  /** The crane as the server returned it after a change to its files. */
  onChanged: (crane: Crane) => void;
  /** Its last file was deleted, which deletes the crane. */
  onDeleted: () => void;
  notify: (message: string, kind?: 'info' | 'success' | 'error') => void;
  /** "Add file": opens the add-file dialog for this crane. */
  onAddFile: () => void;
}

/**
 * The open crane: a strip with one chip per file (open, set as main, rename, delete),
 * then the chosen file in the PDF view. Opens on the crane's main file.
 */
export function Viewer({ crane, onChanged, onDeleted, notify, onAddFile }: ViewerProps) {
  const actions = useFileActions();
  const [chosen, setChosen] = useState<number | null>(null);
  const [find, setFind] = useState<FindState>({ open: false, query: '' });
  const [renaming, setRenaming] = useState<CraneFile | null>(null);
  const [label, setLabel] = useState('');
  const [deleting, setDeleting] = useState<CraneFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const primary = crane.files.find((f) => f.is_primary) ?? crane.files[0];
  // The chosen file while it still exists, else the main one.
  const file = crane.files.find((f) => f.id === chosen) ?? primary;

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setDialogError(null);
    try {
      await work();
    } catch (err) {
      setDialogError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const makePrimary = async (f: CraneFile) => {
    try {
      onChanged(await actions.setPrimary(crane.id, f.id));
      notify('Main file updated', 'success');
    } catch (err) {
      notify(`Could not set main file: ${(err as Error).message}`, 'error');
    }
  };

  const isLast = crane.files.length === 1;

  return (
    <>
      <div
        id="file-strip"
        className="file-strip"
        role="tablist"
        aria-label="Documents for this crane"
      >
        {crane.files.map((f) => {
          const name = fileLabel(f);
          const active = f.id === file?.id;
          return (
            <div
              key={f.id}
              className={`file-chip${f.is_primary ? ' is-primary' : ''}${active ? ' is-active' : ''}`}
              data-file-id={f.id}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                className="file-chip__open"
                title={`View ${name}`}
                onClick={() => setChosen(f.id)}
              >
                <CheckCircle2 size={14} aria-hidden className="file-chip__star" />
                <span className="file-chip__label">{name}</span>
              </button>
              {f.is_primary ? null : (
                <button
                  type="button"
                  className="file-chip__action file-chip__action--primary"
                  title="Set as main file"
                  aria-label={`Set ${name} as main file`}
                  onClick={() => void makePrimary(f)}
                >
                  <Star size={13} aria-hidden />
                </button>
              )}
              <button
                type="button"
                className="file-chip__action file-chip__action--edit"
                title="Rename this file"
                aria-label={`Rename ${name}`}
                onClick={() => {
                  setDialogError(null);
                  setLabel(f.label);
                  setRenaming(f);
                }}
              >
                <Pencil size={13} aria-hidden />
              </button>
              <button
                type="button"
                className="file-chip__action file-chip__action--delete"
                title="Delete this file"
                aria-label={`Delete ${name}`}
                onClick={() => {
                  setDialogError(null);
                  setDeleting(f);
                }}
              >
                <Trash2 size={13} aria-hidden />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          id="file-strip-add"
          className="file-strip__add"
          title="Add a supplementary PDF to this crane"
          onClick={onAddFile}
        >
          <Plus size={14} aria-hidden /> Add file
        </button>
      </div>

      {file ? (
        <PdfView
          key={file.url}
          file={file}
          find={find}
          onFind={setFind}
          onNotice={(m) => notify(m, 'error')}
        />
      ) : null}

      <Dialog
        open={renaming !== null}
        title="Rename file"
        size="sm"
        onClose={() => setRenaming(null)}
        footer={
          <>
            <Button onClick={() => setRenaming(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form="rename-form" busy={busy}>
              Save
            </Button>
          </>
        }
      >
        <form
          id="rename-form"
          onSubmit={(e) => {
            e.preventDefault();
            const target = renaming;
            if (!target) return;
            void run(async () => {
              onChanged(await actions.rename(crane.id, target.id, label.trim()));
              setRenaming(null);
              notify('File renamed', 'success');
            });
          }}
        >
          <TextField
            label="File label — optional"
            placeholder="Outrigger chart, Transport dimensions…"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            {...(dialogError ? { error: dialogError } : {})}
            autoFocus
          />
        </form>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        title="Confirm deletion"
        message={
          deleting
            ? isLast
              ? `“${fileLabel(deleting)}” is the only file. Deleting it removes the whole crane. Continue?`
              : `Delete “${fileLabel(deleting)}” from this crane? This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        danger
        busy={busy}
        error={dialogError}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const target = deleting;
          if (!target) return;
          void run(async () => {
            const result = await actions.remove(crane.id, target.id);
            setDeleting(null);
            notify('File deleted', 'success');
            if (result.crane_deleted) onDeleted();
            else onChanged(result);
          });
        }}
      />
    </>
  );
}
