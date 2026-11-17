import { Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/** The overlay hides itself this long after the last dragover (a drag can end unseen). */
export const DRAG_WATCHDOG_MS = 700;

const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
const dialogOpen = () => document.querySelector('dialog[open]') !== null;

/**
 * Files dragged anywhere over the window show an overlay; dropping hands them to
 * `onDrop`. Ignored while a dialog is open (its own drop target takes over).
 */
export function DropZone({ onDrop }: { onDrop: (files: File[]) => void }) {
  const [visible, setVisible] = useState(false);
  const handler = useRef(onDrop);
  useEffect(() => {
    handler.current = onDrop;
  });

  useEffect(() => {
    let depth = 0;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const hide = () => {
      depth = 0;
      clearTimeout(watchdog);
      setVisible(false);
    };
    const arm = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(hide, DRAG_WATCHDOG_MS);
    };
    const enter = (e: DragEvent) => {
      if (!hasFiles(e) || dialogOpen()) return;
      e.preventDefault();
      depth += 1;
      setVisible(true);
      arm();
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e) || dialogOpen()) return;
      e.preventDefault();
      arm();
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) hide();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      hide();
      if (dialogOpen()) return;
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) handler.current(files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      clearTimeout(watchdog);
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  return (
    <div id="dropzone" className={`dropzone${visible ? ' is-visible' : ''}`} aria-hidden={!visible}>
      <div className="dropzone__panel">
        <Upload size={32} aria-hidden />
        <p className="dropzone__title">Drop PDF to upload</p>
        <p className="dropzone__hint">
          We’ll ask for the manufacturer, type, model, and capacity next.
        </p>
      </div>
    </div>
  );
}
