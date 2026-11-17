import { ChevronDown, Inbox, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Crane } from '../../shared/api.ts';
import { modelOf, searchText, type MakeGroup } from '../lib/catalogue.ts';

/** Rows (type headers count too) added to the models list at a time as it scrolls. */
export const BATCH_SIZE = 60;

type Item = { kind: 'header'; type: string; count: number } | { kind: 'row'; crane: Crane };

export interface SidebarProps {
  groups: MakeGroup[];
  loading: boolean;
  /** The search box's text. */
  query: string;
  /** The make whose models are listed (already resolved to one that exists). */
  make: string | undefined;
  onSelectMake: (make: string) => void;
  /** The open crane. */
  currentId: string | undefined;
  /** A crane whose row must be rendered and scrolled to (e.g. opened from the palette). */
  revealId?: string | undefined;
  /** A crane whose row should take focus once it is shown (e.g. after a delete). */
  focusId?: string | undefined;
  onOpen: (crane: Crane) => void;
  /** Shows the pencil on each row. */
  onEdit?: (crane: Crane) => void;
  onDelete: (crane: Crane) => void;
  open: boolean;
}

/** The makes visible for a query, in order. */
export function visibleMakes(groups: MakeGroup[], query: string): MakeGroup[] {
  const q = query.trim().toLowerCase();
  return q ? groups.filter((g) => g.text.includes(q)) : groups;
}

/**
 * The make to show after the query changes: the current one while it still matches,
 * else the first visible make whose name matches, else the first visible make.
 */
export function makeForQuery(groups: MakeGroup[], query: string, current: string | undefined) {
  const visible = visibleMakes(groups, query);
  if (visible.some((g) => g.make === current)) return current;
  const q = query.trim().toLowerCase();
  return (visible.find((g) => g.make.toLowerCase().includes(q)) ?? visible[0])?.make;
}

const rowMatches = (make: string, crane: Crane, q: string) =>
  !q || `${make.toLowerCase()} ${searchText(crane)}`.includes(q);

export function Sidebar({
  groups,
  loading,
  query,
  make,
  onSelectMake,
  currentId,
  revealId,
  focusId,
  onOpen,
  onEdit,
  onDelete,
  open,
}: SidebarProps) {
  const q = query.trim().toLowerCase();
  const makes = visibleMakes(groups, query);
  const group = groups.find((g) => g.make === make);

  // Collapsed type groups and the batch count belong to one make: switching resets them.
  const [collapse, setCollapse] = useState<{ make: string | undefined; types: Set<string> }>({
    make,
    types: new Set(),
  });
  const collapsed = collapse.make === make ? collapse.types : new Set<string>();
  const [batches, setBatches] = useState<{ make: string | undefined; shown: number }>({
    make,
    shown: BATCH_SIZE,
  });
  const shown = batches.make === make ? batches.shown : BATCH_SIZE;

  const items: Item[] = [];
  for (const t of group?.types ?? []) {
    const rows = t.cranes.filter((c) => rowMatches(make ?? '', c, q));
    if (rows.length === 0) continue;
    items.push({ kind: 'header', type: t.type, count: t.cranes.length });
    for (const crane of rows) items.push({ kind: 'row', crane });
  }
  const revealAt = items.findIndex((i) => i.kind === 'row' && i.crane.id === revealId);
  // A search shows every match; otherwise rows arrive in batches as the list scrolls.
  const limit = q ? items.length : Math.max(shown, revealAt + 1);
  const visibleItems = items.slice(0, limit);
  const more = limit < items.length;

  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!more || !sentinel || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setBatches({ make, shown: limit + BATCH_SIZE });
      },
      { root: listRef.current, rootMargin: '200px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [more, limit, make]);

  useEffect(() => {
    if (!revealId) return;
    listRef.current
      ?.querySelector(`[data-filename="${CSS.escape(revealId)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [revealId, make]);

  useEffect(() => {
    if (!focusId) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-filename="${CSS.escape(focusId)}"] .model-item__body`)
      ?.focus();
  }, [focusId, groups]);

  const toggle = (type: string) => {
    const next = new Set(collapsed);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    setCollapse({ make, types: next });
  };

  const skeleton = loading && groups.length === 0;
  const empty = !loading && groups.length === 0;

  return (
    <nav id="sidebar" className={`sidebar${open ? ' is-open' : ''}`} aria-label="Documents">
      <section className="sidebar__panel">
        <header className="sidebar__heading">
          Manufacturers <span id="makes-count">{skeleton ? '' : makes.length}</span>
        </header>
        <div id="make-list" className="sidebar__list">
          {skeleton ? <Skeleton rows={8} /> : null}
          {empty ? (
            <p className="sidebar__empty">
              <Inbox size={20} aria-hidden /> No specifications yet.
            </p>
          ) : null}
          {makes.map((g) => (
            <button
              key={g.make}
              type="button"
              className={`make-item${g.make === make ? ' is-active' : ''}`}
              data-make={g.make}
              title={g.make}
              aria-current={g.make === make ? 'true' : undefined}
              onClick={() => onSelectMake(g.make)}
            >
              <span className="make-item__name">{g.make}</span>
              <span className="make-item__count">{g.cranes.length}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="sidebar__panel">
        <header className="sidebar__heading">
          Models <span id="models-count">{skeleton ? '' : (group?.cranes.length ?? 0)}</span>
        </header>
        <div id="model-list" className="sidebar__list" ref={listRef}>
          {skeleton ? <Skeleton rows={5} /> : null}
          {q && !skeleton && items.length === 0 ? (
            <p className="sidebar__no-matches" role="status">
              No matches for “{query.trim()}”
            </p>
          ) : null}
          {renderGroups(visibleItems, collapsed, q !== '', toggle, {
            make: make ?? '',
            currentId,
            onOpen,
            onEdit,
            onDelete,
          })}
          {more ? <div className="sidebar__sentinel" ref={sentinelRef} /> : null}
        </div>
      </section>
    </nav>
  );
}

function Skeleton({ rows }: { rows: number }) {
  return (
    <div aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="sidebar__skeleton-row" />
      ))}
    </div>
  );
}

interface RowHandlers {
  make: string;
  currentId: string | undefined;
  onOpen: (crane: Crane) => void;
  onEdit: ((crane: Crane) => void) | undefined;
  onDelete: (crane: Crane) => void;
}

/** Headers and rows, grouped back into one .type-group per type. */
function renderGroups(
  items: Item[],
  collapsed: Set<string>,
  searching: boolean,
  toggle: (type: string) => void,
  handlers: RowHandlers
) {
  const out: Array<{ type: string; count: number; rows: Crane[] }> = [];
  for (const item of items) {
    if (item.kind === 'header') out.push({ type: item.type, count: item.count, rows: [] });
    else out.at(-1)?.rows.push(item.crane);
  }
  return out.map((g) => {
    // A search opens collapsed groups, so every match shows.
    const isCollapsed = collapsed.has(g.type) && !searching;
    return (
      <div key={g.type} className={`type-group${isCollapsed ? ' is-collapsed' : ''}`}>
        <button
          type="button"
          className="type-header"
          aria-expanded={!isCollapsed}
          onClick={() => toggle(g.type)}
        >
          <ChevronDown size={14} aria-hidden className="type-header__chevron" />
          <span className="type-header__label">{g.type}</span>
          <span className="type-header__count">{g.count}</span>
        </button>
        {isCollapsed ? null : g.rows.map((c) => <ModelRow key={c.id} crane={c} {...handlers} />)}
      </div>
    );
  });
}

function ModelRow({ crane, currentId, onOpen, onEdit, onDelete }: RowHandlers & { crane: Crane }) {
  const active = crane.id === currentId;
  return (
    <div className={`model-item${active ? ' is-active' : ''}`} data-filename={crane.name}>
      <button
        type="button"
        className="model-item__body"
        aria-current={active ? 'true' : undefined}
        onClick={() => onOpen(crane)}
      >
        <span className="model-item__name">
          {modelOf(crane)}
          {crane.file_count > 1 ? (
            <span
              className="model-item__filecount"
              title={`${crane.file_count} files`}
              aria-label={`${crane.file_count} files`}
            >
              {crane.file_count}
            </span>
          ) : null}
        </span>
        <span className="model-item__capacity">{crane.capacity}</span>
      </button>
      <span className="model-item__actions">
        {onEdit ? (
          <button
            type="button"
            className="model-item__action model-item__action--edit"
            aria-label="Edit metadata"
            title="Edit metadata"
            onClick={() => onEdit(crane)}
          >
            <Pencil size={14} aria-hidden />
          </button>
        ) : null}
        <button
          type="button"
          className="model-item__action model-item__action--delete"
          aria-label="Delete specification"
          title="Delete"
          onClick={() => onDelete(crane)}
        >
          <Trash2 size={14} aria-hidden />
        </button>
      </span>
    </div>
  );
}
