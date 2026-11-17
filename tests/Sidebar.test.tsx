// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Crane } from '../shared/api.ts';
import {
  BATCH_SIZE,
  Sidebar,
  makeForQuery,
  visibleMakes,
  type SidebarProps,
} from '../src/components/Sidebar.tsx';
import { groupCatalogue } from '../src/lib/catalogue.ts';
import { scrollSentinelsIntoView, setUpDom } from './dom.tsx';
import { crane } from './factories.ts';

beforeEach(setUpDom);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const catalogue = [
  crane({ make: 'Liebherr', type: 'Mobile', model: 'LTM1300-6.2', capacity: '300t' }),
  crane({ make: 'Liebherr', type: 'Mobile', model: 'LTM11200-9.1', capacity: '1200t' }),
  crane({ make: 'Liebherr', type: 'Mobile', model: 'LTM1750-9.1', capacity: '750t' }),
  crane({ make: 'Liebherr', type: 'Crawler', model: 'LR1300', capacity: '300t' }, ['Outrigger']),
  crane({ make: 'Tadano', type: 'Mobile', model: 'AC 500', capacity: '500t' }),
  crane({ make: 'JLG', type: 'Boom', model: 'JB1', capacity: '1t' }),
];

function renderSidebar(over: Partial<SidebarProps> = {}, cranes: Crane[] = catalogue) {
  const groups = groupCatalogue(cranes);
  const props: SidebarProps = {
    groups,
    loading: false,
    query: '',
    make: groups[0]?.make,
    onSelectMake: vi.fn(),
    currentId: undefined,
    onOpen: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    open: false,
    ...over,
  };
  const view = render(<Sidebar {...props} />);
  return { ...view, props, groups };
}

const modelNames = () =>
  [...document.querySelectorAll('.model-item__name')].map((n) => n.firstChild?.textContent);

describe('sidebar', () => {
  it('lists makes with counts and the chosen make’s models by type, in natural order', () => {
    renderSidebar();
    expect([...document.querySelectorAll('.make-item__name')].map((n) => n.textContent)).toEqual([
      'JLG',
      'Liebherr',
      'Tadano',
    ]);
    expect(document.getElementById('makes-count')).toHaveTextContent('3');
    const active = document.querySelector('.make-item.is-active');
    expect(active).toHaveAttribute('data-make', 'JLG');
    expect(active).toHaveAttribute('aria-current', 'true');
  });

  it('sorts models naturally within each type, and badges multi-file cranes', () => {
    renderSidebar({ make: 'Liebherr' });
    expect(document.getElementById('models-count')).toHaveTextContent('4');
    expect([...document.querySelectorAll('.type-header__label')].map((n) => n.textContent)).toEqual(
      ['Crawler', 'Mobile']
    );
    expect(modelNames()).toEqual(['LR1300', 'LTM1300-6.2', 'LTM1750-9.1', 'LTM11200-9.1']);
    const badge = document.querySelector('.model-item__filecount');
    expect(badge).toHaveTextContent('2');
    expect(badge).toHaveAttribute('aria-label', '2 files');
  });

  it('opens, edits and deletes through its callbacks, and marks the open crane', () => {
    const lr = catalogue[3] as Crane;
    const { props } = renderSidebar({ make: 'Liebherr', currentId: lr.id });
    const row = document.querySelector(`[data-filename="${lr.id}"]`) as HTMLElement;
    expect(row).toHaveClass('is-active');
    fireEvent.click(within(row).getByRole('button', { current: true }));
    expect(props.onOpen).toHaveBeenCalledWith(lr);
    fireEvent.click(within(row).getByRole('button', { name: 'Edit metadata' }));
    expect(props.onEdit).toHaveBeenCalledWith(lr);
    fireEvent.click(within(row).getByRole('button', { name: 'Delete specification' }));
    expect(props.onDelete).toHaveBeenCalledWith(lr);
    fireEvent.click(screen.getByRole('button', { name: /^Tadano/ }));
    expect(props.onSelectMake).toHaveBeenCalledWith('Tadano');
  });

  it('hides the pencil when editing is not offered', () => {
    const groups = groupCatalogue(catalogue);
    render(
      <Sidebar
        groups={groups}
        loading={false}
        query=""
        make="JLG"
        onSelectMake={vi.fn()}
        currentId={undefined}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        open
      />
    );
    expect(screen.queryByRole('button', { name: 'Edit metadata' })).toBeNull();
    expect(document.getElementById('sidebar')).toHaveClass('is-open');
  });

  it('collapses and expands a type group', () => {
    renderSidebar({ make: 'Liebherr' });
    const header = screen.getByRole('button', { name: /Crawler/ });
    fireEvent.click(header);
    expect(header.closest('.type-group')).toHaveClass('is-collapsed');
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(modelNames()).not.toContain('LR1300');
    fireEvent.click(header);
    expect(modelNames()).toContain('LR1300');
  });

  it('filters makes and rows, opening collapsed groups, with a no-matches note', () => {
    const { rerender, props } = renderSidebar({ make: 'Liebherr' });
    fireEvent.click(screen.getByRole('button', { name: /Crawler/ }));
    rerender(<Sidebar {...props} query="outrigger" />);
    expect([...document.querySelectorAll('.make-item')].map((m) => m.textContent)).toEqual([
      'Liebherr4',
    ]);
    expect(modelNames()).toEqual(['LR1300']);
    rerender(<Sidebar {...props} query="zzz" make={undefined} />);
    expect(screen.getByRole('status')).toHaveTextContent('No matches for “zzz”');
    expect(document.getElementById('makes-count')).toHaveTextContent('0');
  });

  it('matches rows on their make’s name', () => {
    renderSidebar({ make: 'Tadano', query: 'tadano' });
    expect(modelNames()).toEqual(['AC 500']);
  });

  it('shows skeleton rows while loading, and a note when empty', () => {
    const { rerender, props } = renderSidebar({ loading: true }, []);
    expect(document.querySelectorAll('.sidebar__skeleton-row')).toHaveLength(13);
    rerender(<Sidebar {...props} loading={false} />);
    expect(screen.getByText('No specifications yet.')).toBeInTheDocument();
  });

  it('renders a long make in batches as the list scrolls', () => {
    const many = Array.from({ length: 75 }, (_, i) =>
      crane({ make: 'Big', type: 'Mobile', model: `M${i}` })
    );
    renderSidebar({ make: 'Big' }, many);
    expect(document.querySelectorAll('.model-item')).toHaveLength(BATCH_SIZE - 1);
    act(() => scrollSentinelsIntoView());
    expect(document.querySelectorAll('.model-item')).toHaveLength(75);
    expect(document.querySelector('.sidebar__sentinel')).toBeNull();
  });

  it('renders far enough to show a crane it must reveal, and focuses one after a delete', () => {
    const many = Array.from({ length: 75 }, (_, i) =>
      crane({ make: 'Big', type: 'Mobile', model: `M${String(i).padStart(2, '0')}` })
    );
    const last = many[74] as Crane;
    renderSidebar({ make: 'Big', revealId: last.id, focusId: last.id }, many);
    expect(document.querySelector(`[data-filename="${last.id}"]`)).not.toBeNull();
    expect(document.activeElement).toHaveClass('model-item__body');
  });

  it('works out which make a search shows', () => {
    const groups = groupCatalogue(catalogue);
    expect(visibleMakes(groups, '').map((g) => g.make)).toEqual(['JLG', 'Liebherr', 'Tadano']);
    expect(visibleMakes(groups, '500t').map((g) => g.make)).toEqual(['Tadano']);
    // The current make stays while it matches.
    expect(makeForQuery(groups, 'mobile', 'Tadano')).toBe('Tadano');
    // Otherwise a make whose name matches, else the first visible one.
    expect(makeForQuery(groups, 'jlg', 'Tadano')).toBe('JLG');
    expect(makeForQuery(groups, '300t', 'Tadano')).toBe('Liebherr');
    expect(makeForQuery(groups, 'zzz', 'Tadano')).toBeUndefined();
  });
});
