import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Button, Dialog } from '@hhh/ui';
import type { Facets } from '../../shared/api.ts';
import { useCraneActions } from '../hooks/useCraneActions.ts';
import { isPdf, parseFilename } from '../lib/catalogue.ts';
import { plural } from '../lib/format.ts';
import { withRetry } from '../lib/upload.ts';

export interface Draft {
  key: string;
  make: string;
  model: string;
  type: string;
  capacity: string;
  files: Array<{ file: File; label: string }>;
  /** Index into files of the crane's main file. */
  primary: number;
  status: 'pending' | 'uploading' | 'done' | 'failed';
  error: string;
  /** Set once the crane exists on the server; a retry then only adds missing files. */
  craneId?: string;
  /** Indexes of files already on the server. */
  sent: number[];
}

type Field = 'make' | 'model' | 'type' | 'capacity';
const FIELDS: Array<{ key: Field; title: string; placeholder: string }> = [
  { key: 'make', title: 'Manufacturer', placeholder: 'Liebherr' },
  { key: 'model', title: 'Model', placeholder: 'LTM1100' },
  { key: 'type', title: 'Type', placeholder: 'Mobile' },
  { key: 'capacity', title: 'Capacity', placeholder: '100t' },
];

/** One draft crane per make and model in the file names (ignoring case). */
export function buildDrafts(files: File[]): Draft[] {
  const drafts = new Map<string, Draft>();
  for (const file of files.filter(isPdf)) {
    const { make, model, label } = parseFilename(file.name);
    const key = `${make}|${model}`.toLowerCase();
    const draft = drafts.get(key) ?? {
      key,
      make,
      model,
      type: '',
      capacity: '',
      files: [],
      primary: 0,
      status: 'pending' as const,
      error: '',
      sent: [],
    };
    draft.files.push({ file, label });
    drafts.set(key, draft);
  }
  return [...drafts.values()];
}

/** Each row's problem, if any: missing fields, or the same crane as another row. */
export function validate(drafts: Draft[]): Map<string, string> {
  const problems = new Map<string, string>();
  const seen = new Map<string, string>();
  for (const d of drafts) {
    if (d.status === 'done') continue;
    if (!FIELDS.every((f) => d[f.key].trim())) {
      problems.set(d.key, 'Fill in all four fields');
      continue;
    }
    const id = FIELDS.map((f) => d[f.key].trim().toLowerCase()).join('|');
    if (seen.has(id)) problems.set(d.key, 'Duplicate of another row');
    else seen.set(id, d.key);
  }
  return problems;
}

export interface BulkImportProps {
  files: File[];
  facets: Facets;
  onClose: () => void;
  /** After a run; `imported` cranes finished. Closes the importer when nothing failed. */
  onImported: (imported: number, failed: number) => void;
}

/** Review the cranes found in several PDFs' names, then create them one at a time. */
export function BulkImport({ files, facets, onClose, onImported }: BulkImportProps) {
  const actions = useCraneActions();
  const [drafts, setDrafts] = useState<Draft[]>(() => buildDrafts(files));
  const [fillType, setFillType] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);
  const ids = useId();

  const fileCount = drafts.reduce((n, d) => n + d.files.length, 0);
  const update = (key: string, change: Partial<Draft>) =>
    setDrafts((list) => list.map((d) => (d.key === key ? { ...d, ...change } : d)));

  const run = async () => {
    const problems = validate(drafts);
    setDrafts((list) =>
      list.map((d) => {
        const p = problems.get(d.key);
        return p ? { ...d, status: 'failed', error: p } : d;
      })
    );
    if (problems.size) {
      setError('Some rows need attention: fix the highlighted rows first.');
      return;
    }
    setError(null);
    setRunning(true);
    cancelled.current = false;
    const todo = drafts.filter((d) => d.status !== 'done');
    let done = drafts.length - todo.length;
    let failed = 0;
    for (const [i, draft] of todo.entries()) {
      if (cancelled.current) return;
      setProgress(`Importing… ${i + 1}/${todo.length}`);
      update(draft.key, { status: 'uploading', error: '' });
      let craneId = draft.craneId;
      const sent = [...draft.sent];
      try {
        if (!craneId) {
          const main = draft.files[draft.primary] ?? draft.files[0];
          if (!main) throw new Error('No file');
          const details = {
            make: draft.make.trim(),
            type: draft.type.trim(),
            model: draft.model.trim(),
            capacity: draft.capacity.trim(),
          };
          const created = await withRetry(() =>
            actions.createCrane(details, main.file, main.label)
          );
          craneId = created.id;
          sent.push(draft.files.indexOf(main));
          update(draft.key, { craneId, sent: [...sent] });
        }
        for (const [n, f] of draft.files.entries()) {
          if (sent.includes(n) || cancelled.current) continue;
          const id = craneId;
          await withRetry(() => actions.addFile(id, f.file, f.label));
          sent.push(n);
          update(draft.key, { sent: [...sent] });
        }
        update(draft.key, { status: 'done' });
        done += 1;
      } catch (err) {
        update(draft.key, { status: 'failed', error: (err as Error).message });
        failed += 1;
      }
    }
    if (cancelled.current) return;
    setRunning(false);
    setProgress(failed ? `${done} imported · ${failed} failed — fix and retry` : '');
    onImported(done, failed);
  };

  const anyFailed = drafts.some((d) => d.status === 'failed');
  const applyFill = () =>
    setDrafts((list) => list.map((d) => (d.craneId ? d : { ...d, type: fillType, error: '' })));

  return (
    <Dialog
      open
      size="lg"
      title="Import several PDFs"
      onClose={() => {
        cancelled.current = true;
        onClose();
      }}
      footer={
        <>
          <span className="bulk__progress" aria-live="polite">
            {progress}
          </span>
          <Button
            onClick={() => {
              cancelled.current = true;
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button variant="primary" busy={running} onClick={() => void run()}>
            {anyFailed && progress ? 'Retry failed' : 'Import'}
          </Button>
        </>
      }
    >
      <p className="bulk__summary">
        {plural(fileCount, 'file')} → {plural(drafts.length, 'crane')}. Names like “Liebherr LTM1100
        (Load Chart).pdf” fill in the manufacturer, model and file label; add the type and capacity.
      </p>
      <div className="bulk__fill">
        <label htmlFor={`${ids}-fill`}>Set all types</label>
        <input
          id={`${ids}-fill`}
          list={`${ids}-types`}
          value={fillType}
          placeholder="Mobile"
          onChange={(e) => setFillType(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              applyFill();
            }
          }}
        />
        <Button size="sm" onClick={applyFill}>
          Apply to all
        </Button>
      </div>
      <div className="bulk__grid" role="table" aria-label="Cranes to import">
        <div className="bulk__row bulk__row--head" role="row">
          {FIELDS.map((f) => (
            <span key={f.key} role="columnheader">
              {f.title}
            </span>
          ))}
          <span role="columnheader">Files</span>
          <span role="columnheader">
            <span className="hhh-sr-only">Status</span>
          </span>
        </div>
        {drafts.map((d, row) => (
          <div
            key={d.key}
            role="row"
            className={`bulk__row${d.status === 'failed' ? ' is-invalid' : ''}${d.status === 'done' ? ' is-done' : ''}`}
          >
            {FIELDS.map((f) => (
              <input
                key={f.key}
                role="cell"
                className="bulk__input"
                aria-label={f.key}
                placeholder={f.placeholder}
                value={d[f.key]}
                disabled={d.craneId !== undefined || running}
                {...(f.key === 'make' ? { list: `${ids}-makes` } : {})}
                {...(f.key === 'type' ? { list: `${ids}-types` } : {})}
                onChange={(e) =>
                  update(d.key, { [f.key]: e.target.value, error: '', status: 'pending' })
                }
              />
            ))}
            <div className="bulk__files" role="cell">
              {d.files.map((f, n) => (
                <label key={n} className="bulk__file" title={f.file.name}>
                  {d.files.length > 1 ? (
                    <input
                      type="radio"
                      name={`${ids}-primary-${row}`}
                      title="Make this the main file"
                      checked={d.primary === n}
                      disabled={d.craneId !== undefined || running}
                      onChange={() => update(d.key, { primary: n })}
                    />
                  ) : null}
                  {f.label || f.file.name}
                </label>
              ))}
            </div>
            <span className="bulk__status" role="cell" title={d.error || undefined}>
              {d.status === 'done' ? (
                <CheckCircle2 size={16} aria-label="Imported" />
              ) : d.status === 'failed' ? (
                <AlertCircle size={16} aria-label={d.error} />
              ) : d.status === 'uploading' ? (
                '…'
              ) : null}
            </span>
            {d.status === 'failed' && d.error ? (
              <span className="bulk__error" role="note">
                {d.error}
              </span>
            ) : null}
          </div>
        ))}
      </div>
      {error ? (
        <p className="meta-form__error" role="alert">
          {error}
        </p>
      ) : null}
      <datalist id={`${ids}-makes`}>
        {facets.makes.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <datalist id={`${ids}-types`}>
        {facets.types.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </Dialog>
  );
}
