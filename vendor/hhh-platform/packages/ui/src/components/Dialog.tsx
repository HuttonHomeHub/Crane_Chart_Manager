import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button, IconButton } from './Button.tsx';

export interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Actions, right-aligned; put Cancel before the confirming action. */
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * A modal on the native <dialog> element: it sits in the browser's top layer, traps
 * focus and closes on Esc. Anything shown while it's open (errors from its actions)
 * must be inside it: a toast would render behind its backdrop. Focus returns to
 * whatever opened it.
 */
export function Dialog({ open, title, onClose, children, footer, size = 'md' }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
      opener.current?.focus();
      opener.current = null;
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`hhh-dialog hhh-dialog--${size}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Esc: let the parent's state decide, so open stays the source of truth.
        event.preventDefault();
        onClose();
      }}
    >
      {open ? (
        <>
          <header className="hhh-dialog__header">
            <h2 className="hhh-dialog__title" id={titleId}>
              {title}
            </h2>
            <IconButton label="Close" icon={<X size={18} aria-hidden />} onClick={onClose} />
          </header>
          <div className="hhh-dialog__body">{children}</div>
          {footer ? <footer className="hhh-dialog__footer">{footer}</footer> : null}
        </>
      ) : null}
    </dialog>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Say what will be lost or changed. */
  message: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
  busy?: boolean;
  /** An error from the action, shown inside the dialog. */
  error?: ReactNode;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  danger = false,
  busy = false,
  error,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onCancel}
      size="sm"
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} busy={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="hhh-dialog__message">{message}</div>
      {error ? (
        <p className="hhh-dialog__error" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
