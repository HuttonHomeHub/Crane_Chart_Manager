import { Download, RotateCcw, Upload } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Badge, type Tone } from './Badge.tsx';
import { Button, ButtonLink } from './Button.tsx';
import { ConfirmDialog, Dialog } from './Dialog.tsx';

/** The gear's panel: read-only cards; settings themselves live in the compose file. */
export function SettingsPanel({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} title="Settings" onClose={onClose} size="lg">
      <div className="hhh-settings">{children}</div>
    </Dialog>
  );
}

export function SettingsCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="hhh-card">
      <h3 className="hhh-card__title">{title}</h3>
      {description ? <p className="hhh-card__description">{description}</p> : null}
      {children}
    </section>
  );
}

export interface InfoRow {
  label: string;
  value: ReactNode;
}

export function InfoList({ rows }: { rows: InfoRow[] }) {
  return (
    <dl className="hhh-info-list">
      {rows.map((row) => (
        <div className="hhh-info-list__row" key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface InstanceInfo {
  version: string;
  /** e.g. [{label: 'Catalogue', value: '78 cranes · 91 files'}] */
  counts: InfoRow[];
  paths: { database: string; uploads: string; backups: string };
  /** e.g. [{label: 'Max upload', value: '500 MB'}] */
  limits: InfoRow[];
  trustProxyHops: number;
}

function Path({ children }: { children: string }) {
  return <code className="hhh-path">{children}</code>;
}

export function InstanceInfoCard({ info }: { info: InstanceInfo }) {
  const proxy =
    info.trustProxyHops > 0
      ? `yes (${info.trustProxyHops} hop${info.trustProxyHops === 1 ? '' : 's'})`
      : 'no';
  return (
    <SettingsCard title="This instance">
      <InfoList
        rows={[
          { label: 'Version', value: <span className="hhh-tabular">{info.version}</span> },
          ...info.counts,
          { label: 'Database', value: <Path>{info.paths.database}</Path> },
          { label: 'Uploads', value: <Path>{info.paths.uploads}</Path> },
          { label: 'Backups', value: <Path>{info.paths.backups}</Path> },
          ...info.limits,
          { label: 'Behind proxy', value: proxy },
        ]}
      />
    </SettingsCard>
  );
}

export interface BackupEntry {
  name: string;
  /** Human-readable, e.g. '12.4 MB' */
  size: string;
  /** Human-readable, e.g. '16 Nov 2026, 03:00' */
  created: string;
}

export interface BackupsCardProps {
  status: { tone: Tone; label: string };
  schedule: string;
  backups: BackupEntry[];
  freshDownloadHref: string;
  downloadHref: (name: string) => string;
  onBackupNow: () => Promise<void>;
  onRestore: (name: string) => Promise<void>;
  onUploadRestore: (file: File) => Promise<void>;
}

type Pending = { kind: 'backup'; name: string } | { kind: 'upload'; file: File };

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong';
}

/**
 * Backups: status, Back up now, Download fresh, the list with Download and Restore,
 * and Upload & restore. A restore replaces all data, so it's confirmed first; the
 * server takes a safety backup before restoring, which the message says.
 */
export function BackupsCard({
  status,
  schedule,
  backups,
  freshDownloadHref,
  downloadHref,
  onBackupNow,
  onRestore,
  onUploadRestore,
}: BackupsCardProps) {
  const [busy, setBusy] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  async function backupNow() {
    setBusy(true);
    setCardError(null);
    try {
      await onBackupNow();
    } catch (err) {
      setCardError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmRestore() {
    if (!pending) return;
    setBusy(true);
    setRestoreError(null);
    try {
      if (pending.kind === 'backup') await onRestore(pending.name);
      else await onUploadRestore(pending.file);
      setPending(null);
      setFile(null);
    } catch (err) {
      setRestoreError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const source = pending?.kind === 'backup' ? pending.name : pending?.file.name;

  return (
    <SettingsCard title="Backups">
      <div className="hhh-backups__status">
        <Badge tone={status.tone}>{status.label}</Badge>
        <span className="hhh-backups__schedule">{schedule}</span>
      </div>
      <div className="hhh-backups__actions">
        <Button variant="primary" busy={busy && !pending} onClick={() => void backupNow()}>
          Back up now
        </Button>
        <ButtonLink href={freshDownloadHref} icon={<Download size={16} aria-hidden />}>
          Download fresh
        </ButtonLink>
      </div>
      {cardError ? (
        <p className="hhh-card__error" role="alert">
          {cardError}
        </p>
      ) : null}
      {backups.length === 0 ? (
        <p className="hhh-empty">No backups yet. The first runs on schedule, or use Back up now.</p>
      ) : (
        <ul className="hhh-backups__list">
          {backups.map((b) => (
            <li key={b.name} className="hhh-backups__item">
              <div className="hhh-backups__meta">
                <span className="hhh-backups__name">{b.name}</span>
                <span className="hhh-backups__detail">
                  {b.created} · {b.size}
                </span>
              </div>
              <ButtonLink
                size="sm"
                variant="ghost"
                href={downloadHref(b.name)}
                icon={<Download size={14} aria-hidden />}
              >
                Download
              </ButtonLink>
              <Button
                size="sm"
                variant="ghost"
                icon={<RotateCcw size={14} aria-hidden />}
                onClick={() => {
                  setRestoreError(null);
                  setPending({ kind: 'backup', name: b.name });
                }}
              >
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="hhh-backups__upload">
        <label className="hhh-backups__file">
          <span className="hhh-sr-only">Backup file to restore</span>
          <input type="file" accept=".zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <Button
          icon={<Upload size={16} aria-hidden />}
          disabled={!file}
          onClick={() => {
            if (!file) return;
            setRestoreError(null);
            setPending({ kind: 'upload', file });
          }}
        >
          Upload & restore
        </Button>
      </div>
      <ConfirmDialog
        open={pending !== null}
        title="Restore this backup?"
        message={
          <>
            This replaces all current data with <strong>{source}</strong>. A safety backup of the
            current data is taken first, so you can undo it.
          </>
        }
        confirmLabel="Restore"
        danger
        busy={busy}
        error={restoreError}
        onConfirm={() => void confirmRestore()}
        onCancel={() => setPending(null)}
      />
    </SettingsCard>
  );
}
