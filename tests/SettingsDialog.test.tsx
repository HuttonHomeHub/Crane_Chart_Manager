// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackupsReply, InstanceInfoReply } from '../shared/api.ts';
import { MergeCard, SettingsDialog } from '../src/components/SettingsDialog.tsx';
import { setUpDom } from './dom.tsx';
import { isGet, stubFetch } from './fetchStub.ts';

beforeEach(setUpDom);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const INFO: InstanceInfoReply = {
  version: '2.0.0',
  counts: { cranes: 12, files: 1 },
  paths: { database: '/config/crane.db', uploads: '/config/uploads', backups: '/config/backups' },
  limits: {
    maxUploadMb: 500,
    maxFieldLen: 64,
    uploadRate: { limit: 60, windowMs: 60_000 },
    writeRate: { limit: 30, windowMs: 300_000 },
  },
  trustProxyHops: 1,
};

const backupsReply = (over: Partial<BackupsReply> = {}): BackupsReply => ({
  enabled: true,
  dir: '/config/backups',
  intervalHours: 24,
  keep: 7,
  includeUploads: true,
  backups: [
    {
      name: 'crane-backup-20261116-030000.zip',
      size: 3 * 1024 * 1024,
      createdAt: '2026-11-16T03:00:00Z',
    },
  ],
  scheduler: { enabled: true, intervalHours: 24, lastSuccessAt: '2026-11-16T03:00:00Z' },
  ...over,
});

function stub(backups: BackupsReply = backupsReply()) {
  return stubFetch((url, init) => {
    if (url === '/api/info') return { body: INFO };
    if (url === '/api/backup' && isGet(init)) return { body: backups };
    if (url === '/api/backup') return { status: 201, body: { name: 'x.zip', size: 1 } };
    if (url === '/api/backup/restore')
      return {
        body: { safetyBackup: 'p.zip', restoredUploads: true, counts: { cranes: 1, files: 1 } },
      };
    if (url === '/api/merge-make') return { body: { success: true, moved: 2, absorbed: 1 } };
    return { status: 404 };
  });
}

const renderSettings = (onChanged = vi.fn(async () => undefined)) =>
  render(
    <SettingsDialog
      open
      onClose={vi.fn()}
      makes={['Liebherr', 'Liebherri']}
      onChanged={onChanged}
    />
  );

describe('settings', () => {
  it('shows this instance and its backups', async () => {
    stub();
    renderSettings();
    expect(await screen.findByText('12 cranes · 1 file')).toBeInTheDocument();
    expect(screen.getByText('500 MB per PDF')).toBeInTheDocument();
    expect(screen.getByText('60 per minute')).toBeInTheDocument();
    expect(screen.getByText('30 per 5 min')).toBeInTheDocument();
    expect(screen.getByText(/Daily, database and PDFs, keeping 7/)).toBeInTheDocument();
    expect(screen.getByText('crane-backup-20261116-030000.zip')).toBeInTheDocument();
    expect(screen.getByText(/3.0 MB/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Export metadata/ })).toHaveAttribute(
      'href',
      '/api/export'
    );
  });

  it.each([
    [backupsReply({ enabled: false }), 'Manual only', /Scheduled backups are off/],
    [
      backupsReply({ scheduler: { enabled: true, intervalHours: 24, lastError: 'disk' } }),
      'Last scheduled backup failed',
      /Daily/,
    ],
    [
      backupsReply({
        backups: [],
        intervalHours: 6,
        includeUploads: false,
        scheduler: { enabled: true, intervalHours: 6, nextRunAt: '2026-11-17T03:00:00Z' },
      }),
      'No backups yet',
      /Every 6 h, database only, keeping 7, next 17 Nov 2026/,
    ],
  ])('summarises the schedule (%#)', async (reply, label, schedule) => {
    stub(reply);
    renderSettings();
    expect(await screen.findByText(label)).toBeInTheDocument();
    expect(screen.getByText(schedule)).toBeInTheDocument();
  });

  it('restores a backup after confirming, then reloads the catalogue', async () => {
    const fetchMock = stub();
    const onChanged = vi.fn(async () => undefined);
    renderSettings(onChanged);
    fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));
    const dialog = screen.getByRole('dialog', { name: 'Restore this backup?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const restore = fetchMock.mock.calls.find(([u]) => u === '/api/backup/restore');
    expect(JSON.parse(String(restore?.[1]?.body))).toEqual({
      name: 'crane-backup-20261116-030000.zip',
    });
  });

  it('restores an uploaded zip', async () => {
    const fetchMock = stub();
    const onChanged = vi.fn(async () => undefined);
    renderSettings(onChanged);
    const input = (await screen.findByLabelText('Backup file to restore')) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['zip'], 'mine.zip')] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload & restore' }));
    const dialog = screen.getByRole('dialog', { name: 'Restore this backup?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const restore = fetchMock.mock.calls.find(([u]) => u === '/api/backup/restore');
    expect(restore?.[1]?.body).toBeInstanceOf(FormData);
  });

  it('backs up now', async () => {
    const fetchMock = stub();
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: 'Back up now' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([u, i]) => u === '/api/backup' && i?.method === 'POST')
      ).toBe(true)
    );
  });

  it('merges manufacturers through the settings API', async () => {
    const fetchMock = stub();
    const onChanged = vi.fn(async () => undefined);
    renderSettings(onChanged);
    fireEvent.change(screen.getByLabelText('From'), { target: { value: 'Liebherri' } });
    fireEvent.change(screen.getByLabelText('Into'), { target: { value: 'Liebherr' } });
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    const dialog = screen.getByRole('dialog', { name: 'Confirm merge' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Merge' }));
    expect(await screen.findByText('Merged 3 cranes into “Liebherr”.')).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
    const merge = fetchMock.mock.calls.find(([u]) => u === '/api/merge-make');
    expect(JSON.parse(String(merge?.[1]?.body))).toEqual({ from: 'Liebherri', into: 'Liebherr' });
  });
});

describe('merge card', () => {
  it('needs two different manufacturers', () => {
    render(<MergeCard makes={['A', 'B']} merge={vi.fn()} />);
    const status = screen.getByRole('status');
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    expect(status).toHaveTextContent('Pick both manufacturers.');
    fireEvent.change(screen.getByLabelText('From'), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText('Into'), { target: { value: 'A' } });
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    expect(status).toHaveTextContent('Pick two different manufacturers.');
  });

  it('shows a failure inside its confirmation', async () => {
    const merge = vi.fn(async () => {
      throw new Error('Merge failed: locked');
    });
    render(<MergeCard makes={['A', 'B']} merge={merge} />);
    fireEvent.change(screen.getByLabelText('From'), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText('Into'), { target: { value: 'B' } });
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    const dialog = screen.getByRole('dialog', { name: 'Confirm merge' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Merge' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Merge failed: locked');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  });
});
