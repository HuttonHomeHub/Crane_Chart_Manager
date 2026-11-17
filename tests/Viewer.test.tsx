// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Crane } from '../shared/api.ts';
import { Viewer, fileLabel } from '../src/components/Viewer.tsx';
import { setUpDom } from './dom.tsx';
import { crane } from './factories.ts';
import { fakePdfs } from './fakePdf.tsx';
import { stubFetch, type Route } from './fetchStub.ts';

vi.mock('../src/lib/pdfjs.ts', () => import('./fakePdf.tsx'));

beforeEach(setUpDom);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(c: Crane, route: Route = () => ({ status: 404 })) {
  for (const f of c.files) fakePdfs.set(f.url, [['page']]);
  const props = { onChanged: vi.fn(), onDeleted: vi.fn(), notify: vi.fn() };
  const fetchMock = stubFetch(route);
  render(<Viewer crane={c} {...props} />);
  return { ...props, fetchMock };
}

const chip = (label: string) =>
  screen.getByRole('tab', { name: label }).closest('.file-chip') as HTMLElement;

describe('the file strip', () => {
  it('has a chip per file, the main one first and open', () => {
    const c = crane({}, ['Outrigger chart']);
    setup(c);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['chart.pdf', 'Outrigger chart']);
    expect(chip('chart.pdf')).toHaveClass('is-primary', 'is-active');
    expect(within(chip('chart.pdf')).queryByRole('button', { name: /main file/ })).toBeNull();
  });

  it('switches the file shown', async () => {
    const c = crane({}, ['Outrigger chart']);
    setup(c);
    fireEvent.click(screen.getByRole('tab', { name: 'Outrigger chart' }));
    expect(chip('Outrigger chart')).toHaveClass('is-active');
    expect(await screen.findByRole('link', { name: 'Download PDF' })).toHaveAttribute(
      'href',
      c.files[1]?.url
    );
  });

  it('sets the main file and passes the updated crane on', async () => {
    const c = crane({}, ['Outrigger chart']);
    const updated = { ...c, success: true };
    const { onChanged, notify, fetchMock } = setup(c, () => ({ body: updated }));
    fireEvent.click(screen.getByRole('button', { name: 'Set Outrigger chart as main file' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(updated));
    expect(notify).toHaveBeenCalledWith('Main file updated', 'success');
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`/api/cranes/${c.id}/primary`);
    expect(JSON.parse(String(init?.body))).toEqual({ file_id: c.files[1]?.id });
  });

  it('reports a main-file change that failed', async () => {
    const c = crane({}, ['Outrigger chart']);
    const { notify } = setup(c, () => ({ status: 500, body: { error: 'Locked' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Set Outrigger chart as main file' }));
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith('Could not set main file: Locked', 'error')
    );
  });

  it('renames a file, keeping errors in the dialog', async () => {
    const c = crane({}, ['Outrigger chart']);
    let fail = true;
    const { onChanged, fetchMock } = setup(c, () =>
      fail ? { status: 400, body: { error: 'Label is too long' } } : { body: c }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Rename Outrigger chart' }));
    const dialog = screen.getByRole('dialog', { name: 'Rename file' });
    const field = within(dialog).getByLabelText('File label — optional');
    expect(field).toHaveValue('Outrigger chart');
    fireEvent.change(field, { target: { value: ' Dims ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Label is too long')).toBeInTheDocument();
    fail = false;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(c));
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))).toEqual({ label: 'Dims' });
    fireEvent.click(screen.getByRole('button', { name: 'Rename chart.pdf' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Rename file' })).getByRole('button', {
        name: 'Cancel',
      })
    );
  });

  it('deletes a file, or the crane with its last file, after confirming', async () => {
    const two = crane({}, ['Outrigger chart']);
    const after = { ...two, files: two.files.slice(0, 1), success: true, crane_deleted: false };
    const first = setup(two, () => ({ body: after }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Outrigger chart' }));
    const dialog = screen.getByRole('dialog', { name: 'Confirm deletion' });
    expect(dialog).toHaveTextContent('Delete “Outrigger chart” from this crane?');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(first.onChanged).toHaveBeenCalledWith(after));
    cleanup();

    const one = crane({ model: 'Solo' });
    const second = setup(one, () => ({ body: { success: true, crane_deleted: true } }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete chart.pdf' }));
    const last = screen.getByRole('dialog', { name: 'Confirm deletion' });
    expect(last).toHaveTextContent('is the only file. Deleting it removes the whole crane.');
    fireEvent.click(within(last).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(second.onDeleted).toHaveBeenCalled());
    expect(second.notify).toHaveBeenCalledWith('File deleted', 'success');
  });

  it('names a file by its label, then its original name, then its stored name', () => {
    const [f] = crane().files;
    if (!f) throw new Error('no file');
    expect(fileLabel({ ...f, label: 'L' })).toBe('L');
    expect(fileLabel({ ...f, label: '', original_filename: 'o.pdf' })).toBe('o.pdf');
    expect(fileLabel({ ...f, label: '', original_filename: '', stored_name: 's.pdf' })).toBe(
      's.pdf'
    );
    expect(fileLabel({ ...f, label: '', original_filename: '', stored_name: '' })).toBe('Document');
  });
});
