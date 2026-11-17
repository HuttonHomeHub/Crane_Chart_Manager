// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BulkImport, buildDrafts, validate } from '../src/components/BulkImport.tsx';
import { setUpDom } from './dom.tsx';
import { stubXhr, type UploadReply } from './fakeXhr.tsx';

beforeEach(setUpDom);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const pdf = (name: string) => new File(['%PDF-1.4'], name, { type: 'application/pdf' });
const files = [
  pdf('Liebherr LTM1100 (Load Chart).pdf'),
  pdf('liebherr ltm1100 (Outrigger).pdf'),
  pdf('Tadano AC100.pdf'),
  new File(['x'], 'notes.txt'),
];

describe('drafts', () => {
  it('groups PDFs by make and model, ignoring case and non-PDFs', () => {
    const drafts = buildDrafts(files);
    expect(drafts.map((d) => [d.make, d.model, d.files.map((f) => f.label)])).toEqual([
      ['Liebherr', 'LTM1100', ['Load Chart', 'Outrigger']],
      ['Tadano', 'AC100', ['']],
    ]);
  });

  it('flags rows missing a field, and duplicates', () => {
    const [a, b] = buildDrafts(files);
    if (!a || !b) throw new Error('drafts');
    const full = { type: 'Mobile', capacity: '100t' };
    expect(validate([a, b]).get(a.key)).toBe('Fill in all four fields');
    const dup = { ...b, ...full, make: 'LIEBHERR', model: 'ltm1100' };
    expect(validate([{ ...a, ...full }, dup]).get(dup.key)).toBe('Duplicate of another row');
    expect(
      validate([
        { ...a, ...full, status: 'done' },
        { ...b, status: 'done' },
      ]).size
    ).toBe(0);
  });
});

function start(reply: (url: string, form: FormData) => UploadReply) {
  const sent = stubXhr(reply);
  const props = { onClose: vi.fn(), onImported: vi.fn() };
  render(<BulkImport files={files} facets={{ makes: [], types: ['Mobile'] }} {...props} />);
  return { ...props, sent };
}

const rows = () => screen.getAllByRole('row').slice(1);
const cell = (row: HTMLElement, name: string) => within(row).getByLabelText(name);

describe('the bulk importer', () => {
  it('reviews, then creates each crane and adds its other files', async () => {
    const { sent, onImported } = start((url, form) => ({
      status: 201,
      body: { id: `${String(form.get('make') ?? 'x').toLowerCase()}-id`, url },
    }));
    expect(screen.getByText(/3 files → 2 cranes/)).toBeInTheDocument();
    const [lieb, tad] = rows();
    if (!lieb || !tad) throw new Error('rows');
    expect(cell(lieb, 'make')).toHaveValue('Liebherr');
    fireEvent.change(screen.getByLabelText('Set all types'), { target: { value: 'Mobile' } });
    fireEvent.keyDown(screen.getByLabelText('Set all types'), { key: 'Enter' });
    expect(cell(tad, 'type')).toHaveValue('Mobile');
    fireEvent.change(cell(lieb, 'capacity'), { target: { value: '100t' } });
    fireEvent.change(cell(tad, 'capacity'), { target: { value: '100t' } });
    // The Outrigger chart becomes the main file.
    fireEvent.click(within(lieb).getAllByRole('radio')[1] as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(2, 0));
    expect(sent.map((s) => [s.url, s.form.get('label')])).toEqual([
      ['/api/upload', 'Outrigger'],
      ['/api/cranes/liebherr-id/files', 'Load Chart'],
      ['/api/upload', null],
    ]);
    expect(within(lieb).getByLabelText('Imported')).toBeInTheDocument();
  });

  it('holds back rows that need attention', () => {
    const { sent } = start(() => ({ status: 201, body: { id: 'x' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Some rows need attention');
    expect(screen.getAllByText('Fill in all four fields')).toHaveLength(2);
    expect(sent).toHaveLength(0);
    const [lieb] = rows();
    if (!lieb) throw new Error('row');
    fireEvent.change(cell(lieb, 'type'), { target: { value: 'Crawler' } });
    expect(within(lieb).queryByText('Fill in all four fields')).toBeNull();
  });

  it('retries only what failed, without making a crane twice', async () => {
    let failExtra = true;
    const { sent, onImported } = start((url, form) =>
      url.endsWith('/files') && failExtra
        ? { status: 500, body: { error: 'Disk full' } }
        : { status: 201, body: { id: `${String(form.get('make')).toLowerCase()}-id` } }
    );
    fireEvent.change(screen.getByLabelText('Set all types'), { target: { value: 'Mobile' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply to all' }));
    for (const row of rows()) fireEvent.change(cell(row, 'capacity'), { target: { value: '9t' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(1, 1));
    expect(screen.getByText('1 imported · 1 failed — fix and retry')).toBeInTheDocument();
    expect(screen.getByText('Disk full')).toBeInTheDocument();
    const [lieb] = rows();
    if (!lieb) throw new Error('row');
    expect(cell(lieb, 'make')).toBeDisabled();
    failExtra = false;
    sent.length = 0;
    fireEvent.click(screen.getByRole('button', { name: 'Retry failed' }));
    await waitFor(() => expect(onImported).toHaveBeenLastCalledWith(2, 0));
    expect(sent.map((s) => s.url)).toEqual(['/api/cranes/liebherr-id/files']);
  });

  it('stops when closed', async () => {
    const { onClose, onImported } = start(() => ({ status: 201, body: { id: 'x' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(onImported).not.toHaveBeenCalled();
  });
});
