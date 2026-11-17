import { FileText, Upload } from 'lucide-react';
import { Button } from '@hhh/ui';

/** The viewer before a crane is chosen; the copy depends on whether any exist yet. */
export function EmptyState({ hasCranes, onUpload }: { hasCranes: boolean; onUpload: () => void }) {
  return (
    <div id="viewer-empty" className="viewer__empty">
      <FileText size={40} aria-hidden className="viewer__empty-icon" />
      <h2>{hasCranes ? 'No document selected' : 'No specifications uploaded yet'}</h2>
      <p>
        {hasCranes
          ? 'Choose a manufacturer and model from the sidebar, or drag a PDF onto the window to upload another.'
          : 'Drag a PDF anywhere on this window, or click upload to add your first spec.'}
      </p>
      <Button id="empty-upload-btn" icon={<Upload size={16} aria-hidden />} onClick={onUpload}>
        {hasCranes ? 'Upload another specification' : 'Upload your first spec'}
      </Button>
    </div>
  );
}
