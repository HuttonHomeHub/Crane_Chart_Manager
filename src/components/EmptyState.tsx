import { FileText } from 'lucide-react';

/** The viewer before a crane is chosen; the copy depends on whether any exist yet. */
export function EmptyState({ hasCranes }: { hasCranes: boolean }) {
  return (
    <div id="viewer-empty" className="viewer__empty">
      <FileText size={40} aria-hidden className="viewer__empty-icon" />
      <h2>{hasCranes ? 'No document selected' : 'No specifications uploaded yet'}</h2>
      <p>
        {hasCranes
          ? 'Choose a manufacturer and model from the sidebar, or drag a PDF onto the window to upload another.'
          : 'Drag a PDF anywhere on this window, or click upload to add your first spec.'}
      </p>
    </div>
  );
}
