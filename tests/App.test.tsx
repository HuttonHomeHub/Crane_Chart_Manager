// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@hhh/ui';
import type { Crane } from '../shared/api.ts';
import { App, neighbourOf } from '../src/App.tsx';
import { PAGE_SIZE } from '../src/hooks/useCatalogue.ts';
import { setNarrow, setUpDom } from './dom.tsx';
import { crane } from './factories.ts';
import { fakePdfs } from './fakePdf.tsx';
import { stubXhr } from './fakeXhr.tsx';
import { isGet, stubFetch, type Route } from './fetchStub.ts';

vi.mock('../src/lib/pdfjs.ts', () => import('./fakePdf.tsx'));

beforeEach(() => {
  setUpDom();
  window.location.hash = '';
  setNarrow(false);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const lr = crane({ make: 'Liebherr', type: 'Crawler', model: 'LR1300', capacity: '300t' });
const ltm = crane({ make: 'Liebherr', type: 'Mobile', model: 'LTM1100', capacity: '100t' });
const ac = crane({ make: 'Tadano', type: 'Mobile', model: 'AC 500', capacity: '500t' });

/** The API with `cranes` in it; DELETE /api/delete/:id removes one. */
function api(
  cranes: Crane[],
  extra: Route = () => ({ status: 404, body: { error: 'Not found' } })
) {
  let list = [...cranes];
  const route: Route = (url, init) => {
    if (url === '/version') return { body: { version: '2.0.0' } };
    if (url.startsWith('/api/pdfs')) {
      const params = new URLSearchParams(url.split('?')[1]);
      const after = params.get('after');
      const start = after ? list.findIndex((c) => c.id === after) + 1 : 0;
      const items = list.slice(start, start + PAGE_SIZE);
      const more = start + PAGE_SIZE < list.length;
      return {
        body: { items, total: list.length, next_cursor: more ? (items.at(-1)?.id ?? null) : null },
      };
    }
    if (url === '/api/facets')
      return { body: { makes: [...new Set(list.map((c) => c.make))], types: [] } };
    if (url.startsWith('/api/delete/') && init.method === 'DELETE') {
      const id = decodeURIComponent(url.slice('/api/delete/'.length));
      list = list.filter((c) => c.id !== id);
      return { body: { success: true } };
    }
    return extra(url, init);
  };
  return stubFetch(route);
}

const renderApp = () =>
  render(
    <ToastProvider>
      <App />
    </ToastProvider>
  );

describe('the app', () => {
  it('shows the version, the catalogue and the empty viewer', async () => {
    api([lr, ltm, ac]);
    renderApp();
    expect(await screen.findByText('2.0.0')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /^Liebherr/ })).toHaveClass('is-active');
    expect(screen.getByRole('heading', { name: 'No document selected' })).toBeInTheDocument();
    expect(document.title).toBe('Crane Charts');
  });

  it('invites a first upload when the catalogue is empty', async () => {
    api([]);
    renderApp();
    expect(await screen.findByText('No specifications yet.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No specifications uploaded yet' })).toBeVisible();
  });

  it('loads a large catalogue page by page', async () => {
    const many = Array.from({ length: PAGE_SIZE + 5 }, (_, i) =>
      crane({ make: `Make${String(i).padStart(3, '0')}` })
    );
    const fetchMock = api(many);
    renderApp();
    await waitFor(() => expect(document.getElementById('makes-count')).toHaveTextContent('205'));
    const pages = fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/pdfs'));
    expect(pages.map(([u]) => String(u))).toEqual([
      `/api/pdfs?limit=${PAGE_SIZE}`,
      `/api/pdfs?limit=${PAGE_SIZE}&after=${many[PAGE_SIZE - 1]?.id}`,
    ]);
  });

  it('opens a crane: info bar, file strip, tab title and a #crane/ link', async () => {
    api([lr, ltm, ac]);
    renderApp();
    fireEvent.click(await screen.findByText('LR1300'));
    await waitFor(() => expect(window.location.hash).toBe(`#crane/${lr.id}`));
    expect(screen.getByRole('tablist', { name: 'Documents for this crane' })).toBeVisible();
    expect(document.getElementById('info-model')).toHaveTextContent('LR1300');
    expect(document.getElementById('info-capacity')).toHaveTextContent('300t');
    expect(document.title).toBe('Liebherr LR1300 · Crane Charts');
  });

  it('jumps to the make a search names, and keeps it while it matches', async () => {
    api([lr, ltm, ac]);
    renderApp();
    await screen.findByText('LR1300');
    const search = screen.getByRole('searchbox', { name: 'Filter the sidebar list' });
    fireEvent.change(search, { target: { value: 'tadano' } });
    expect(screen.getByRole('button', { name: /^Tadano/ })).toHaveClass('is-active');
    expect(screen.queryByRole('button', { name: /^Liebherr/ })).toBeNull();
    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getByRole('button', { name: /^Tadano/ })).toHaveClass('is-active');
    fireEvent.keyDown(search, { key: 'Escape' });
  });

  it('deletes a crane after confirming, closes it if open, and focuses its neighbour', async () => {
    api([lr, ltm, ac]);
    renderApp();
    fireEvent.click(await screen.findByText('LTM1100'));
    const row = document.querySelector(`[data-filename="${ltm.id}"]`) as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Delete specification' }));
    const dialog = screen.getByRole('dialog', { name: 'Confirm deletion' });
    expect(dialog).toHaveTextContent('Delete “LTM1100 (100t)”? This cannot be undone.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Specification deleted')).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector(`[data-filename="${ltm.id}"]`)).toBeNull());
    expect(screen.getByRole('heading', { name: 'No document selected' })).toBeInTheDocument();
    await waitFor(() =>
      expect(document.activeElement?.closest('.model-item')).toHaveAttribute('data-filename', lr.id)
    );
  });

  it('keeps a failed delete’s error in the dialog, and cancels', async () => {
    stubFetch((url, init) => {
      if (!isGet(init)) return { status: 500, body: { error: 'Disk full' } };
      if (url === '/version') return { body: { version: '2.0.0' } };
      if (url === '/api/facets') return { body: { makes: ['Liebherr'], types: [] } };
      return { body: { items: [lr], total: 1, next_cursor: null } };
    });
    renderApp();
    await screen.findByText('LR1300');
    fireEvent.click(screen.getByRole('button', { name: 'Delete specification' }));
    const dialog = screen.getByRole('dialog', { name: 'Confirm deletion' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Disk full');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Confirm deletion' })).toBeNull()
    );
  });

  it('reports a catalogue that will not load', async () => {
    stubFetch((url) =>
      url === '/version' ? { status: 500 } : { status: 500, body: { error: 'Database locked' } }
    );
    renderApp();
    expect(await screen.findByText('Could not load documents: Database locked')).toBeVisible();
  });

  it('turns the sidebar into a drawer on narrow screens', async () => {
    setNarrow(true);
    api([lr, ltm]);
    renderApp();
    await screen.findByText('LR1300');
    const menu = screen.getByRole('button', { name: 'Toggle navigation' });
    fireEvent.click(menu);
    expect(document.getElementById('sidebar')).toHaveClass('is-open');
    expect(document.querySelector('main')).toHaveAttribute('inert');
    fireEvent.click(screen.getByText('LR1300'));
    expect(document.getElementById('sidebar')).not.toHaveClass('is-open');
    fireEvent.click(menu);
    fireEvent.click(document.querySelector('.sidebar-scrim') as Element);
    expect(document.getElementById('sidebar')).not.toHaveClass('is-open');
  });

  it('opens Settings from the app bar', async () => {
    api([lr], (url) =>
      url === '/api/info' || url === '/api/backup'
        ? { status: 500, body: { error: 'Nope' } }
        : { status: 404 }
    );
    renderApp();
    await screen.findByText('LR1300');
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(await screen.findByText('Could not load settings: Nope')).toBeInTheDocument();
  });
});

describe('links', () => {
  it('opens the crane a link names, selecting its make', async () => {
    window.location.hash = `#crane/${encodeURIComponent(ac.id)}`;
    api([lr, ltm, ac]);
    renderApp();
    expect(await screen.findByText('AC 500', { selector: '#info-model' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Tadano/ })).toHaveClass('is-active');
    expect(document.querySelector(`[data-filename="${ac.id}"]`)).toHaveClass('is-active');
  });

  it('follows Back and Forward between cranes, and ignores unknown ones', async () => {
    api([lr, ltm, ac]);
    renderApp();
    fireEvent.click(await screen.findByText('LR1300'));
    window.location.hash = `#crane/${ac.id}`;
    fireEvent(window, new HashChangeEvent('hashchange'));
    expect(await screen.findByText('AC 500', { selector: '#info-model' })).toBeInTheDocument();
    window.location.hash = '#crane/nothing-here';
    fireEvent(window, new HashChangeEvent('hashchange'));
    expect(
      await screen.findByRole('heading', { name: 'No document selected' })
    ).toBeInTheDocument();
  });

  it('updates the strip after a file change, and empties the viewer when the crane goes', async () => {
    const two = crane({ make: 'Grove', model: 'GMK', capacity: '50t' }, ['Dims']);
    const routeCalls: string[] = [];
    let list = [two];
    stubFetch((url, init) => {
      routeCalls.push(`${init.method ?? 'GET'} ${url}`);
      if (url === '/version') return { body: { version: '2.0.0' } };
      if (url === '/api/facets') return { body: { makes: ['Grove'], types: [] } };
      if (url.startsWith('/api/pdfs'))
        return { body: { items: list, total: list.length, next_cursor: null } };
      if (url.endsWith('/primary')) {
        const swapped = {
          ...two,
          files: two.files.map((f) => ({ ...f, is_primary: !f.is_primary })).reverse(),
        };
        list = [swapped];
        return { body: { success: true, ...swapped } };
      }
      list = [];
      return { body: { success: true, crane_deleted: true } };
    });
    for (const f of two.files) fakePdfs.set(f.url, [['x']]);
    renderApp();
    fireEvent.click(await screen.findByText('GMK'));
    fireEvent.click(await screen.findByRole('button', { name: 'Set Dims as main file' }));
    await waitFor(() => expect(screen.getAllByRole('tab')[0]).toHaveTextContent('Dims'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Dims' }));
    const dialog = screen.getByRole('dialog', { name: 'Confirm deletion' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(
      await screen.findByRole('heading', { name: 'No specifications uploaded yet' })
    ).toBeInTheDocument();
    expect(routeCalls.filter((c) => c.startsWith('GET /api/pdfs')).length).toBeGreaterThan(1);
  });
});

describe('uploading and editing', () => {
  const pdf = (name: string) => new File(['%PDF-1.4'], name, { type: 'application/pdf' });
  const drop = (files: File[]) =>
    fireEvent(
      window,
      Object.assign(new Event('drop', { bubbles: true, cancelable: true }), {
        dataTransfer: { types: ['Files'], files },
      })
    );

  it('uploads from the app bar, then reloads the list', async () => {
    const fetchMock = api([lr]);
    stubXhr(() => ({ status: 201, body: ac }));
    renderApp();
    await screen.findByText('LR1300');
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    const dialog = screen.getByRole('dialog', { name: 'Upload crane specification' });
    fireEvent.change(within(dialog).getByLabelText('PDF file'), {
      target: { files: [pdf('Tadano AC 500.pdf')] },
    });
    fireEvent.change(within(dialog).getByLabelText('Type'), { target: { value: 'Mobile' } });
    fireEvent.change(within(dialog).getByLabelText('Rated capacity'), {
      target: { value: '500t' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
    expect(await screen.findByText('Specification uploaded')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Upload crane specification' })).toBeNull()
    );
    const listLoads = fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/pdfs'));
    expect(listLoads.length).toBeGreaterThan(1);
  });

  it('routes a drop: upload with nothing open, add-file with a crane open, bulk for several', async () => {
    api([lr]);
    fakePdfs.set(lr.files[0]?.url ?? '', [['x']]);
    renderApp();
    await screen.findByText('LR1300');
    drop([new File(['x'], 'notes.txt')]);
    expect(await screen.findByText('Only PDF files can be uploaded.')).toBeInTheDocument();
    drop([pdf('Grove GMK.pdf')]);
    let dialog = screen.getByRole('dialog', { name: 'Upload crane specification' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByText('LR1300'));
    await screen.findByRole('tablist');
    drop([pdf('dims.pdf')]);
    dialog = screen.getByRole('dialog', { name: 'Add file to Liebherr LR1300' });
    fireEvent.click(within(dialog).getByRole('button', { name: /Create a new crane instead/ }));
    expect(screen.getByRole('dialog', { name: 'Upload crane specification' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    drop([pdf('A B.pdf'), pdf('C D.pdf')]);
    expect(screen.getByRole('dialog', { name: 'Import several PDFs' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    drop([]);
  });

  it('adds a file from the strip and shows it', async () => {
    const withExtra = crane(
      { make: 'Liebherr', type: 'Crawler', model: 'LR1300', capacity: '300t' },
      ['Dims']
    );
    let list = [lr];
    stubFetch((url) => {
      if (url === '/version') return { body: { version: '2.0.0' } };
      if (url === '/api/facets') return { body: { makes: ['Liebherr'], types: [] } };
      return { body: { items: list, total: list.length, next_cursor: null } };
    });
    stubXhr(() => {
      list = [withExtra];
      return { status: 201, body: { success: true, ...withExtra } };
    });
    for (const f of [...lr.files, ...withExtra.files]) fakePdfs.set(f.url, [['x']]);
    renderApp();
    fireEvent.click(await screen.findByText('LR1300'));
    fireEvent.click(await screen.findByRole('button', { name: /Add file/ }));
    const dialog = screen.getByRole('dialog', { name: 'Add file to Liebherr LR1300' });
    fireEvent.change(within(dialog).getByLabelText('PDF file'), {
      target: { files: [pdf('dims.pdf')] },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add file' }));
    expect(await screen.findByText('File added')).toBeInTheDocument();
    expect(await screen.findByRole('tab', { name: 'Dims' })).toBeInTheDocument();
  });

  it('edits from the sidebar, following a renamed open crane to its new address', async () => {
    const renamed = { ...lr, id: 'liebherr_crawler_lr1300_350t', name: 'x', capacity: '350t' };
    let list = [lr];
    stubFetch((url, init) => {
      if (url === '/version') return { body: { version: '2.0.0' } };
      if (url === '/api/facets') return { body: { makes: ['Liebherr'], types: ['Crawler'] } };
      if (url.startsWith('/api/pdfs'))
        return { body: { items: list, total: list.length, next_cursor: null } };
      if (init.method === 'PUT') {
        list = [renamed];
        return { body: { success: true, renamed: true, old_name: lr.id, ...renamed } };
      }
      return { status: 404 };
    });
    fakePdfs.set(lr.files[0]?.url ?? '', [['x']]);
    renderApp();
    fireEvent.click(await screen.findByText('LR1300'));
    fireEvent.click(screen.getByRole('button', { name: 'Edit metadata' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit specification' });
    fireEvent.change(within(dialog).getByLabelText('Rated capacity'), {
      target: { value: '350t' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Saved & renamed')).toBeInTheDocument();
    await waitFor(() => expect(window.location.hash).toBe(`#crane/${renamed.id}`));
    expect(await screen.findByText('350t', { selector: '#info-capacity' })).toBeInTheDocument();
  });

  it('imports several PDFs and reports it', async () => {
    api([]);
    stubXhr((_url, form) => ({ status: 201, body: { id: String(form.get('make')) } }));
    renderApp();
    await screen.findByText('No specifications yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Upload your first spec' }));
    fireEvent.change(screen.getByLabelText('PDF file'), {
      target: { files: [pdf('A One.pdf'), pdf('B Two.pdf')] },
    });
    const dialog = screen.getByRole('dialog', { name: 'Import several PDFs' });
    fireEvent.change(within(dialog).getByLabelText('Set all types'), {
      target: { value: 'Mobile' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply to all' }));
    for (const input of within(dialog).getAllByLabelText('capacity'))
      fireEvent.change(input, { target: { value: '1t' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    expect(await screen.findByText('Imported 2 cranes')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Import several PDFs' })).toBeNull()
    );
  });
});

describe('neighbourOf', () => {
  it('prefers the next crane in the same type, then the previous, then the make’s', () => {
    const a = crane({ make: 'M', type: 'T', model: 'A' });
    const b = crane({ make: 'M', type: 'T', model: 'B' });
    const c = crane({ make: 'M', type: 'U', model: 'C' });
    expect(neighbourOf([a, b, c], a)).toBe(b.id);
    expect(neighbourOf([a, b, c], b)).toBe(a.id);
    expect(neighbourOf([a, b, c], c)).toBe(b.id);
    expect(neighbourOf([c], c)).toBeUndefined();
  });
});
