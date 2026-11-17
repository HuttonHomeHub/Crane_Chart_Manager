import { Download } from 'lucide-react';
import { useState } from 'react';
import {
  BackupsCard,
  Button,
  ButtonLink,
  ConfirmDialog,
  InstanceInfoCard,
  Select,
  SettingsCard,
  SettingsPanel,
  type Tone,
} from '@hhh/ui';
import type { BackupsReply, InstanceInfoReply } from '../../shared/api.ts';
import { useSettings } from '../hooks/useSettings.ts';
import { formatBytes, formatWhen, plural } from '../lib/format.ts';

function backupStatus(data: BackupsReply): { tone: Tone; label: string } {
  const { scheduler, backups } = data;
  if (scheduler.lastError) return { tone: 'danger', label: 'Last scheduled backup failed' };
  if (!data.enabled) return { tone: 'neutral', label: 'Manual only' };
  const latest = scheduler.lastSuccessAt ?? backups[0]?.createdAt;
  if (latest) return { tone: 'success', label: `Latest ${formatWhen(latest)}` };
  return { tone: 'warning', label: 'No backups yet' };
}

function scheduleText(data: BackupsReply): string {
  const every = data.intervalHours === 24 ? 'Daily' : `Every ${data.intervalHours} h`;
  const what = data.includeUploads ? 'database and PDFs' : 'database only';
  const next = data.scheduler.nextRunAt ? `, next ${formatWhen(data.scheduler.nextRunAt)}` : '';
  return data.enabled
    ? `${every}, ${what}, keeping ${data.keep}${next}`
    : 'Scheduled backups are off (BACKUP_ENABLED); back up by hand below';
}

const perMinute = (r: { limit: number; windowMs: number }) =>
  `${r.limit} per ${r.windowMs === 60_000 ? 'minute' : `${Math.round(r.windowMs / 60_000)} min`}`;

function infoFor(info: InstanceInfoReply) {
  return {
    version: info.version,
    counts: [
      {
        label: 'Catalogue',
        value: `${plural(info.counts.cranes, 'crane')} · ${plural(info.counts.files, 'file')}`,
      },
    ],
    paths: info.paths,
    limits: [
      { label: 'Max upload', value: `${info.limits.maxUploadMb} MB per PDF` },
      { label: 'Field length', value: `${info.limits.maxFieldLen} characters` },
      { label: 'Uploads', value: perMinute(info.limits.uploadRate) },
      { label: 'Other changes', value: perMinute(info.limits.writeRate) },
    ],
    trustProxyHops: info.trustProxyHops,
  };
}

export interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  /** Manufacturers in use, for the merge tool. */
  makes: string[];
  /** Called after a restore or merge changed the catalogue, so the app can reload it. */
  onChanged: () => Promise<void>;
}

/** The gear's panel: this instance's set-up, its backups, merging and export. */
export function SettingsDialog({ open, onClose, makes, onChanged }: SettingsDialogProps) {
  const { info, backups, error, backupNow, restore, mergeMakes } = useSettings(open);

  return (
    <SettingsPanel open={open} onClose={onClose}>
      {error ? (
        <SettingsCard title="Settings unavailable">
          <p role="alert">Could not load settings: {error}</p>
        </SettingsCard>
      ) : null}
      {info ? <InstanceInfoCard info={infoFor(info)} /> : null}
      {backups ? (
        <BackupsCard
          status={backupStatus(backups)}
          schedule={scheduleText(backups)}
          backups={backups.backups.map((b) => ({
            name: b.name,
            size: formatBytes(b.size),
            created: formatWhen(b.createdAt),
          }))}
          freshDownloadHref="/api/backup/download"
          downloadHref={(name) => `/api/backup/download/${encodeURIComponent(name)}`}
          onBackupNow={backupNow}
          onRestore={async (name) => {
            await restore(name);
            await onChanged();
          }}
          onUploadRestore={async (file) => {
            await restore(file);
            await onChanged();
          }}
        />
      ) : null}
      <MergeCard
        makes={makes}
        merge={async (from, into) => {
          const result = await mergeMakes(from, into);
          await onChanged();
          return result.moved + result.absorbed;
        }}
      />
      <SettingsCard
        title="Export"
        description="Every crane and its files, as JSON. Deployment settings live in the compose file."
      >
        <ButtonLink
          id="settings-export"
          href="/api/export"
          download
          icon={<Download size={16} aria-hidden />}
        >
          Export metadata (JSON)
        </ButtonLink>
      </SettingsCard>
    </SettingsPanel>
  );
}

/** Moves every crane of one manufacturer onto another (a typo fix), after confirming. */
export function MergeCard({
  makes,
  merge,
}: {
  makes: string[];
  merge: (from: string, into: string) => Promise<number>;
}) {
  const [from, setFrom] = useState('');
  const [into, setInto] = useState('');
  const [status, setStatus] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A choice that disappeared (merged away) counts as no choice.
  const fromValue = makes.includes(from) ? from : '';
  const intoValue = makes.includes(into) ? into : '';

  const start = () => {
    if (!fromValue || !intoValue) setStatus('Pick both manufacturers.');
    else if (fromValue === intoValue) setStatus('Pick two different manufacturers.');
    else {
      setStatus('');
      setError(null);
      setConfirming(true);
    }
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const n = await merge(fromValue, intoValue);
      setConfirming(false);
      setStatus(`Merged ${plural(n, 'crane')} into “${intoValue}”.`);
      setFrom('');
    } catch (err) {
      setError((err as Error).message || 'Merge failed');
    } finally {
      setBusy(false);
    }
  };

  const options = makes.map((m) => (
    <option key={m} value={m}>
      {m}
    </option>
  ));

  return (
    <SettingsCard
      title="Merge manufacturers"
      description="Fixes a misspelt manufacturer: every crane under the first moves to the second."
    >
      <div className="merge">
        <Select label="From" value={fromValue} onChange={(e) => setFrom(e.target.value)}>
          <option value="">From…</option>
          {options}
        </Select>
        <Select label="Into" value={intoValue} onChange={(e) => setInto(e.target.value)}>
          <option value="">Into…</option>
          {options}
        </Select>
        <Button id="merge-btn" onClick={start}>
          Merge
        </Button>
      </div>
      <p id="merge-status" className="merge__status" role="status">
        {status}
      </p>
      <ConfirmDialog
        open={confirming}
        title="Confirm merge"
        message={`Move all “${fromValue}” cranes onto “${intoValue}”? This can’t be undone.`}
        confirmLabel="Merge"
        danger
        busy={busy}
        error={error}
        onConfirm={() => void run()}
        onCancel={() => setConfirming(false)}
      />
    </SettingsCard>
  );
}
