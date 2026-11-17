import { useEffect, useRef, useState } from 'react';
import { Dialog } from '@hhh/ui';
import type { Crane } from '../../shared/api.ts';
import { paletteMatches } from '../lib/catalogue.ts';

export interface CommandPaletteProps {
  cranes: Crane[];
  onChoose: (crane: Crane) => void;
  onClose: () => void;
}

/**
 * Jump to a crane by make, type, model, capacity or file label; ">=150", "≥150" or
 * "150t+" lists everything at least that big, smallest first. ↑↓ choose, Enter opens.
 */
export function CommandPalette({ cranes, onChoose, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = paletteMatches(cranes, query);
  const index = Math.min(active, Math.max(0, results.length - 1));

  // After the dialog has opened (its effect runs first), so focus lands here.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    listRef.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }, [index, query]);

  return (
    <Dialog open title="Find a crane" onClose={onClose}>
      <div className="palette">
        <input
          ref={inputRef}
          id="palette-input"
          className="palette__input"
          type="search"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-results"
          aria-activedescendant={results[index] ? `palette-${results[index].id}` : undefined}
          aria-label="Jump to a crane"
          placeholder="Jump to a crane — make, model, or capacity (try ≥150t)"
          spellCheck={false}
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive(Math.min(index + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive(Math.max(index - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const chosen = results[index];
              if (chosen) onChoose(chosen);
            }
          }}
        />
        <ul id="palette-results" className="palette__results" role="listbox" ref={listRef}>
          {results.length === 0 ? (
            <li className="palette__empty">
              {cranes.length ? 'No cranes match.' : 'No cranes yet.'}
            </li>
          ) : (
            results.map((c, i) => (
              <li
                key={c.id}
                id={`palette-${c.id}`}
                role="option"
                aria-selected={i === index}
                className={`palette__result${i === index ? ' is-active' : ''}`}
                onMouseMove={() => setActive(i)}
                onClick={() => onChoose(c)}
              >
                <span className="palette__result-title">
                  {c.make} {c.model}
                </span>
                <span className="palette__result-meta">
                  {[c.capacity, c.type, c.file_count > 1 ? `${c.file_count} files` : '']
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </li>
            ))
          )}
        </ul>
        <p className="palette__hint">↑↓ navigate · ↵ open · Esc close</p>
      </div>
    </Dialog>
  );
}
