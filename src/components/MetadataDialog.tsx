import { FileUp } from 'lucide-react';
import { useId, useRef, useState, type FormEvent } from 'react';
import { Button, Dialog, TextField } from '@hhh/ui';
import type { Crane, CraneReply, Facets, MetadataReply } from '../../shared/api.ts';
import { useCraneActions, type CraneDetails } from '../hooks/useCraneActions.ts';
import { isPdf, parseFilename } from '../lib/catalogue.ts';

export type MetaRequest =
  | { mode: 'upload'; file?: File }
  | { mode: 'edit'; crane: Crane }
  | { mode: 'addfile'; crane: Crane; file?: File };

export type MetaResult =
  | { mode: 'upload'; crane: CraneReply }
  | { mode: 'addfile'; crane: CraneReply }
  | { mode: 'edit'; crane: MetadataReply; oldId: string };

export interface MetadataDialogProps {
  request: MetaRequest;
  facets: Facets;
  onClose: () => void;
  onSaved: (result: MetaResult) => void;
  /** Several PDFs were chosen while uploading: the bulk importer takes over. */
  onBulk: (files: File[]) => void;
  /** "Create a new crane instead" from adding a file. */
  onSwitch: (request: MetaRequest) => void;
}

const FIELDS: Array<{ key: keyof CraneDetails; label: string; placeholder: string }> = [
  { key: 'make', label: 'Manufacturer', placeholder: 'Liebherr, Tadano, Manitowoc…' },
  { key: 'type', label: 'Type', placeholder: 'Mobile, Crawler, Tower…' },
  { key: 'model', label: 'Model', placeholder: 'LTM 1200-3.1' },
  { key: 'capacity', label: 'Rated capacity', placeholder: '200 t' },
];

function initialDetails(request: MetaRequest): CraneDetails {
  if (request.mode === 'edit') {
    const { make, type, model, capacity } = request.crane;
    return { make, type, model, capacity };
  }
  const blank = { make: '', type: '', model: '', capacity: '' };
  return request.mode === 'upload' && request.file ? prefill(blank, request.file) : blank;
}

/** Make and model from the file name, into fields still empty. */
function prefill(details: CraneDetails, file: File): CraneDetails {
  const parsed = parseFilename(file.name);
  return {
    ...details,
    make: details.make || parsed.make,
    model: details.model || parsed.model,
  };
}

/** Upload a new crane, edit one's details, or add a file to one. */
export function MetadataDialog({
  request,
  facets,
  onClose,
  onSaved,
  onBulk,
  onSwitch,
}: MetadataDialogProps) {
  const actions = useCraneActions();
  const { mode } = request;
  const [details, setDetails] = useState<CraneDetails>(() => initialDetails(request));
  const [file, setFile] = useState<File | undefined>(
    request.mode === 'edit' ? undefined : request.file
  );
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const ids = useId();
  const makesList = `${ids}-makes`;
  const typesList = `${ids}-types`;

  const crane = request.mode === 'upload' ? undefined : request.crane;
  const title =
    mode === 'upload'
      ? 'Upload crane specification'
      : mode === 'edit'
        ? 'Edit specification'
        : crane
          ? `Add file to ${crane.make} ${crane.model}`
          : 'Add file';
  const submitLabel = mode === 'upload' ? 'Upload' : mode === 'edit' ? 'Save changes' : 'Add file';
  const busy = progress !== null;

  const choose = (files: File[]) => {
    setError(null);
    if (mode === 'upload' && files.length > 1) {
      onBulk(files);
      return;
    }
    const [first] = files;
    if (!first) return;
    setFile(first);
    if (mode === 'upload') setDetails((d) => prefill(d, first));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (mode !== 'edit' && !file) {
      setError('Choose a PDF first.');
      return;
    }
    const trimmed: CraneDetails = {
      make: details.make.trim(),
      type: details.type.trim(),
      model: details.model.trim(),
      capacity: details.capacity.trim(),
    };
    if (mode !== 'addfile') {
      const missing = FIELDS.find((f) => !trimmed[f.key]);
      if (missing) {
        setError('All four fields are required.');
        formRef.current?.querySelector<HTMLInputElement>(`[name="${missing.key}"]`)?.focus();
        return;
      }
    }
    setProgress(0);
    const onProgress = (pct: number) => setProgress(pct);
    try {
      if (request.mode === 'upload' && file) {
        onSaved({
          mode: 'upload',
          crane: await actions.createCrane(trimmed, file, '', onProgress),
        });
      } else if (request.mode === 'addfile' && file) {
        const added = await actions.addFile(request.crane.id, file, label.trim(), onProgress);
        onSaved({ mode: 'addfile', crane: added });
      } else if (request.mode === 'edit') {
        const edited = await actions.editCrane(request.crane.id, trimmed);
        onSaved({ mode: 'edit', crane: edited, oldId: request.crane.id });
      }
    } catch (err) {
      setError((err as Error).message);
      setProgress(null);
    }
  };

  const busyLabel =
    progress === null
      ? submitLabel
      : mode === 'edit' || progress >= 100
        ? 'Saving…'
        : `Uploading… ${progress}%`;

  return (
    <Dialog
      open
      title={title}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={`${ids}-form`} busy={busy}>
            {busyLabel}
          </Button>
        </>
      }
    >
      <form
        id={`${ids}-form`}
        ref={formRef}
        className="meta-form"
        onSubmit={(e) => void submit(e)}
        noValidate
      >
        {mode !== 'edit' ? (
          <div
            className={`file-field${dragOver ? ' is-dragover' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOver(false);
              const pdfs = [...e.dataTransfer.files].filter(isPdf);
              if (pdfs.length === 0) setError('Only PDF files can be uploaded.');
              else choose(pdfs);
            }}
          >
            <button
              type="button"
              className="file-picker"
              onClick={() => fileInput.current?.click()}
            >
              <FileUp size={20} aria-hidden />
              <span className="file-picker__text">
                {file ? file.name : 'Click to choose a PDF'}
              </span>
              <span className="file-picker__hint">PDF only · or drop one onto this box</span>
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf,.pdf"
              multiple={mode === 'upload'}
              hidden
              aria-label="PDF file"
              onChange={(e) => {
                choose([...(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />
          </div>
        ) : null}

        {mode !== 'addfile' ? (
          <div className="meta-form__grid">
            {FIELDS.map((f) => (
              <TextField
                key={f.key}
                name={f.key}
                label={f.label}
                placeholder={f.placeholder}
                value={details[f.key]}
                autoComplete="off"
                {...(f.key === 'make' ? { list: makesList } : {})}
                {...(f.key === 'type' ? { list: typesList } : {})}
                onChange={(e) => setDetails((d) => ({ ...d, [f.key]: e.target.value }))}
              />
            ))}
          </div>
        ) : (
          <TextField
            name="label"
            label="File label — optional"
            placeholder="Outrigger chart, Transport dimensions…"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        )}

        {request.mode === 'addfile' ? (
          <button
            type="button"
            className="meta-form__switch"
            onClick={() => onSwitch(file ? { mode: 'upload', file } : { mode: 'upload' })}
          >
            Create a new crane instead →
          </button>
        ) : null}

        {error ? (
          <p className="meta-form__error" role="alert">
            {error}
          </p>
        ) : null}

        <datalist id={makesList}>
          {facets.makes.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <datalist id={typesList}>
          {facets.types.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </form>
    </Dialog>
  );
}
