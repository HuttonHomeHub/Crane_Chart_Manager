import { X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { IconButton } from './Button.tsx';

export type ToastKind = 'info' | 'success' | 'error';
type ShowToast = (message: string, kind?: ToastKind) => void;

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

const ToastContext = createContext<ShowToast | null>(null);

export const TOAST_DURATION_MS = 4000;

/**
 * Toasts appear bottom-right, one line each. Info and success dismiss themselves after
 * 4 s; errors stay until dismissed. Use them for confirmations, never instead of an
 * inline error, and never from inside a dialog (they'd sit behind its backdrop).
 */
export function ToastProvider({
  children,
  duration = TOAST_DURATION_MS,
}: {
  children: ReactNode;
  duration?: number;
}) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback<ShowToast>(
    (message, kind = 'info') => {
      const id = nextId.current++;
      setToasts((list) => [...list, { id, message, kind }]);
      if (kind !== 'error') {
        const timer = setTimeout(() => {
          timers.current.delete(timer);
          dismiss(id);
        }, duration);
        timers.current.add(timer);
      }
    },
    [dismiss, duration]
  );

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((t) => clearTimeout(t));
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="hhh-toasts" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`hhh-toast hhh-toast--${t.kind}`}
            role={t.kind === 'error' ? 'alert' : 'status'}
          >
            <span className="hhh-toast__message">{t.message}</span>
            <IconButton
              label="Dismiss"
              icon={<X size={16} aria-hidden />}
              onClick={() => dismiss(t.id)}
            />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ShowToast {
  const show = useContext(ToastContext);
  if (!show) throw new Error('useToast must be used inside <ToastProvider>');
  return show;
}
