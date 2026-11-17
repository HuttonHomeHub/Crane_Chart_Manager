import { Dialog } from '@hhh/ui';
import { modKey } from '../lib/keys.ts';

/** The keyboard shortcuts, from the app bar's keyboard button or "?". */
export function ShortcutsDialog({ onClose, mac }: { onClose: () => void; mac: boolean }) {
  const rows: Array<[string, string[]]> = [
    ['Find a crane', [modKey('K', mac)]],
    ['Upload', [modKey('U', mac)]],
    ['Find in the document', [modKey('F', mac), '/']],
    ['Previous / next page', ['←', '→']],
    ['Zoom in / out', ['+', '−']],
    ['Fullscreen', ['F']],
    ['Close / exit', ['Esc']],
    ['This list', ['?']],
  ];
  return (
    <Dialog open title="Keyboard shortcuts" size="sm" onClose={onClose}>
      <dl className="shortcuts">
        {rows.map(([what, keys]) => (
          <div key={what} className="shortcuts__row">
            <dt>{what}</dt>
            <dd>
              {keys.map((k) => (
                <kbd key={k} className="kbd">
                  {k}
                </kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
