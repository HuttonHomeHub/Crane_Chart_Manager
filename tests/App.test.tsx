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
