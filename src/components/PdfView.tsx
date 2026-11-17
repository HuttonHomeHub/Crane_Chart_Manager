import {
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Download,
  Maximize,
  Minimize,
  MoveHorizontal,
  Scan,
  Search,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CraneFile } from '../../shared/api.ts';
import {
  findMatches,
  firstMatchFrom,
  highlightBox,
  nextFit,
  scaleFor,
  zoomStep,
  type FitMode,
  type Match,
  type TextPiece,
} from '../lib/pdf.ts';
import { loadPdf, type PdfDoc } from '../lib/pdfjs.ts';

/** Waits this long after typing before searching the document. */
export const FIND_DEBOUNCE_MS = 180;

export interface FindState {
  open: boolean;
  query: string;
}

export interface PdfViewProps {
  file: CraneFile;
  find: FindState;
  onFind: (next: FindState) => void;
  /** A warning (e.g. fullscreen refused), shown as a toast. */
  onNotice: (message: string) => void;
}

interface Rendered {
  page: number;
  scale: number;
  transform: number[];
  size: { width: number; height: number };
}

const subscribeFullscreen = (cb: () => void) => {
  document.addEventListener('fullscreenchange', cb);
  return () => document.removeEventListener('fullscreenchange', cb);
};
const isFullscreen = () => document.fullscreenElement != null;

/** Typing in a field, or a dialog open: single-key shortcuts stand aside. */
function shortcutsBlocked(event: KeyboardEvent): boolean {
  const t = event.target as HTMLElement | null;
  return (
    t?.tagName === 'INPUT' ||
    t?.tagName === 'TEXTAREA' ||
    t?.tagName === 'SELECT' ||
    t?.isContentEditable === true ||
    document.querySelector('dialog[open]') !== null
  );
}

/** One PDF: loading, the page on a canvas, the toolbar, find and its highlights. */
export function PdfView({ file, find, onFind, onNotice }: PdfViewProps) {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(1);
  const [mode, setMode] = useState<FitMode>('page');
  const [zoom, setZoom] = useState(1);
  const [well, setWell] = useState({ width: 0, height: 0 });
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [matches, setMatches] = useState<{ query: string; list: Match[] }>({
    query: '',
    list: [],
  });
  const [current, setCurrent] = useState(-1);
  const [pageInput, setPageInput] = useState<string | null>(null);
  const fullscreen = useSyncExternalStore(subscribeFullscreen, isFullscreen, () => false);

  const wellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textCache = useRef(new Map<number, TextPiece[]>());
  const findInput = useRef<HTMLInputElement>(null);
  const currentBox = useRef<HTMLDivElement>(null);
  // The page find starts from, read when a search runs (not a reason to search again).
  const pageRef = useRef(page);
  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  const pageCount = doc?.pageCount ?? 0;

  // Load (this component is keyed by the file, so one load per mount).
  useEffect(() => {
    const load = loadPdf(file.url);
    let loaded: PdfDoc | null = null;
    let live = true;
    load.promise.then(
      (d) => {
        loaded = d;
        if (live) setDoc(d);
        else d.destroy();
      },
      () => {
        if (live) setFailed(true);
      }
    );
    return () => {
      live = false;
      if (loaded) loaded.destroy();
      else load.cancel();
    };
  }, [file.url]);

  // The well's size, for fitting the page.
  useEffect(() => {
    const el = wellRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const style = getComputedStyle(el);
      const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) || 0;
      const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) || 0;
      setWell({ width: el.clientWidth - padX, height: el.clientHeight - padY });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Render the page. A newer render cancels an older one still drawing.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!doc || !canvas || (mode !== 'custom' && well.width <= 0)) return;
    let cancel: (() => void) | undefined;
    let live = true;
    void (async () => {
      try {
        const p = await doc.page(page);
        if (!live) return;
        const scale = scaleFor(mode, zoom, p.size, well);
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        const task = p.render(canvas, scale, dpr);
        cancel = task.cancel;
        await task.promise;
        if (!live) return;
        setRendered({
          page,
          scale,
          transform: task.transform,
          size: { width: p.size.width * scale, height: p.size.height * scale },
        });
      } catch {
        // Cancelled by a newer render, or a page PDF.js can't draw: keep the last one.
      }
    })();
    return () => {
      live = false;
      cancel?.();
    };
  }, [doc, page, mode, zoom, well]);

  // Find: search every page's text, a moment after typing stops.
  const query = find.open ? find.query.trim() : '';
  useEffect(() => {
    if (!doc || !query) return;
    let live = true;
    const timer = setTimeout(() => {
      void (async () => {
        for (let n = 1; n <= doc.pageCount && live; n += 1) {
          if (!textCache.current.has(n)) {
            const p = await doc.page(n);
            textCache.current.set(n, await p.text());
          }
        }
        if (!live) return;
        const list = findMatches(textCache.current, query);
        const first = firstMatchFrom(list, pageRef.current);
        setMatches({ query, list });
        setCurrent(first);
        const target = list[first];
        if (target) setPage(target.page);
      })();
    }, FIND_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [doc, query]);

  const shown = matches.query === query && query ? matches.list : [];
  const index = shown.length ? Math.min(current, shown.length - 1) : -1;
  const count = !query ? '' : shown.length ? `${index + 1}/${shown.length}` : '0/0';

  const goToMatch = (i: number) => {
    if (!shown.length) return;
    const next = (i + shown.length) % shown.length;
    setCurrent(next);
    const target = shown[next];
    if (target && target.page !== page) setPage(target.page);
  };

  useEffect(() => {
    currentBox.current?.scrollIntoView({ block: 'center', inline: 'center' });
  }, [index, rendered]);

  const go = (n: number) => setPage(Math.min(Math.max(1, n), Math.max(1, pageCount)));
  const zoomBy = (direction: 1 | -1) => {
    // From the zoom asked for; in a fit mode, from the scale it fitted to.
    const from = mode === 'custom' ? zoom : (rendered?.scale ?? zoom);
    setZoom(zoomStep(from, direction));
    setMode('custom');
  };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    const root = document.documentElement;
    if (typeof root.requestFullscreen !== 'function') {
      onNotice('Fullscreen unavailable');
      return;
    }
    root.requestFullscreen().catch(() => onNotice('Could not enter fullscreen'));
  };
  const openFind = () => {
    onFind({ ...find, open: true });
    // The input exists already (hidden) and is shown in this render.
    requestAnimationFrame(() => findInput.current?.select());
  };

  // Keyboard: ←/→ pages, +/- zoom, F fullscreen, Ctrl/⌘+F or / find.
  const keys = useRef({ go, zoomBy, toggleFullscreen, openFind, page, doc });
  useEffect(() => {
    keys.current = { go, zoomBy, toggleFullscreen, openFind, page, doc };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const k = keys.current;
      if (!k.doc) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        k.openFind();
        return;
      }
      if (mod || event.altKey || shortcutsBlocked(event)) return;
      const action: Record<string, () => void> = {
        ArrowLeft: () => k.go(k.page - 1),
        ArrowRight: () => k.go(k.page + 1),
        '+': () => k.zoomBy(1),
        '=': () => k.zoomBy(1),
        '-': () => k.zoomBy(-1),
        _: () => k.zoomBy(-1),
        f: k.toggleFullscreen,
        F: k.toggleFullscreen,
        '/': k.openFind,
      };
      const run = action[event.key];
      if (run) {
        event.preventDefault();
        run();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const name = file.original_filename || file.stored_name || 'document.pdf';
  const onPage = rendered && rendered.page === page ? rendered : null;

  return (
    <>
      <div
        id="find-bar"
        className="find-bar"
        role="search"
        hidden={!find.open}
        aria-label="Find in document"
      >
        <Search size={14} aria-hidden />
        <input
          ref={findInput}
          id="find-input"
          type="search"
          placeholder="Find in document…"
          aria-label="Find in document"
          value={find.query}
          onChange={(e) => onFind({ open: true, query: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              goToMatch(index + (e.shiftKey ? -1 : 1));
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              onFind({ ...find, open: false });
            }
          }}
        />
        <span id="find-count" className="find-bar__count" aria-live="polite">
          {count}
        </span>
        <button
          type="button"
          id="find-prev"
          className="tool"
          title="Previous match (Shift+Enter)"
          aria-label="Previous match"
          disabled={!shown.length}
          onClick={() => goToMatch(index - 1)}
        >
          <ChevronUp size={16} aria-hidden />
        </button>
        <button
          type="button"
          id="find-next"
          className="tool"
          title="Next match (Enter)"
          aria-label="Next match"
          disabled={!shown.length}
          onClick={() => goToMatch(index + 1)}
        >
          <ChevronDown size={16} aria-hidden />
        </button>
        <button
          type="button"
          id="find-close"
          className="tool"
          title="Close (Esc)"
          aria-label="Close find"
          onClick={() => onFind({ ...find, open: false })}
        >
          <X size={16} aria-hidden />
        </button>
      </div>

      <div id="pdf-viewer" className="viewer__well" ref={wellRef}>
        {failed ? (
          <p className="viewer__error" role="alert">
            Could not open this PDF.
          </p>
        ) : null}
        {!doc && !failed ? <div id="viewer-skeleton" className="viewer__skeleton" /> : null}
        <div id="pdf-stage" className="pdf-stage" hidden={!doc}>
          <canvas ref={canvasRef} id="pdf-canvas" aria-label={`Page ${page} of ${name}`} />
          <div id="pdf-highlights" className="pdf-highlights" aria-hidden>
            {onPage
              ? shown.map((m, i) =>
                  m.page === page ? (
                    <div
                      key={i}
                      ref={i === index ? currentBox : undefined}
                      className={`pdf-highlight${i === index ? ' is-current' : ''}`}
                      style={highlightBox(m.piece, onPage.transform, onPage.scale, onPage.size)}
                    />
                  ) : null
                )
              : null}
          </div>
        </div>
      </div>

      <div id="toolbar" className="toolbar" role="toolbar" aria-label="PDF controls" hidden={!doc}>
        <button
          type="button"
          id="prev-page"
          className="tool"
          aria-label="Previous page"
          title="Previous page (←)"
          disabled={page <= 1}
          onClick={() => go(page - 1)}
        >
          <ChevronLeft size={18} aria-hidden />
        </button>
        <input
          id="page-input"
          className="toolbar__page"
          type="number"
          min={1}
          max={pageCount}
          aria-label="Page"
          value={pageInput ?? String(page)}
          onChange={(e) => setPageInput(e.target.value)}
          onBlur={() => {
            if (pageInput !== null && pageInput !== '') go(Number(pageInput));
            setPageInput(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        <span className="toolbar__of">/</span>
        <span id="page-total">{pageCount}</span>
        <button
          type="button"
          id="next-page"
          className="tool"
          aria-label="Next page"
          title="Next page (→)"
          disabled={page >= pageCount}
          onClick={() => go(page + 1)}
        >
          <ChevronRight size={18} aria-hidden />
        </button>
        <span className="toolbar__divider" />
        <button
          type="button"
          id="zoom-out"
          className="tool"
          aria-label="Zoom out"
          title="Zoom out (−)"
          onClick={() => zoomBy(-1)}
        >
          <ZoomOut size={18} aria-hidden />
        </button>
        <button
          type="button"
          id="zoom-level"
          className="tool toolbar__zoom"
          title="Cycle fit page, fit width and 100%"
          onClick={() => {
            const next = nextFit(mode);
            setMode(next.mode);
            if (next.zoom !== undefined) setZoom(next.zoom);
          }}
        >
          {rendered ? `${Math.round(rendered.scale * 100)}%` : '—'}
        </button>
        <button
          type="button"
          id="zoom-in"
          className="tool"
          aria-label="Zoom in"
          title="Zoom in (+)"
          onClick={() => zoomBy(1)}
        >
          <ZoomIn size={18} aria-hidden />
        </button>
        <span className="toolbar__divider toolbar__divider--fit" />
        <button
          type="button"
          id="fit-width"
          className={`tool toolbar__fit${mode === 'width' ? ' is-on' : ''}`}
          aria-label="Fit width"
          title="Fit width"
          aria-pressed={mode === 'width'}
          onClick={() => setMode('width')}
        >
          <MoveHorizontal size={18} aria-hidden />
        </button>
        <button
          type="button"
          id="fit-page"
          className={`tool toolbar__fit${mode === 'page' ? ' is-on' : ''}`}
          aria-label="Fit page"
          title="Fit page"
          aria-pressed={mode === 'page'}
          onClick={() => setMode('page')}
        >
          <Scan size={18} aria-hidden />
        </button>
        <span className="toolbar__divider toolbar__divider--fit" />
        <button
          type="button"
          id="find-btn"
          className="tool"
          aria-label="Find in document"
          title="Find in document (Ctrl+F or /)"
          onClick={openFind}
        >
          <Search size={18} aria-hidden />
        </button>
        <a
          id="download-btn"
          className="tool"
          href={file.url}
          download={name}
          aria-label="Download PDF"
          title="Download PDF"
        >
          <Download size={18} aria-hidden />
        </a>
        <button
          type="button"
          id="fullscreen-btn"
          className="tool toolbar__fullscreen"
          aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          title="Fullscreen (F)"
          onClick={toggleFullscreen}
        >
          {fullscreen ? <Minimize size={18} aria-hidden /> : <Maximize size={18} aria-hidden />}
        </button>
      </div>
    </>
  );
}
