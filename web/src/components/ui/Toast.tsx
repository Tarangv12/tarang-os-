import * as React from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, Undo2, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastTone = 'success' | 'error' | 'info' | 'warning';

type Toast = {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  duration: number;
};

type ToastInput = {
  title: string;
  description?: string;
  tone?: ToastTone;
  action?: { label: string; onClick: () => void };
  duration?: number;
};

type ToastApi = {
  show: (input: ToastInput) => number;
  success: (title: string, description?: string, action?: ToastInput['action']) => number;
  error: (title: string, description?: string) => number;
  info: (title: string, description?: string, action?: ToastInput['action']) => number;
  warning: (title: string, description?: string) => number;
  dismiss: (id: number) => void;
};

const ToastContext = React.createContext<ToastApi | null>(null);

let nextId = 1;

const TONE_META: Record<ToastTone, { icon: React.ReactNode; accent: string }> = {
  success: { icon: <CheckCircle2 className="h-4 w-4" />, accent: 'text-success' },
  error: { icon: <XCircle className="h-4 w-4" />, accent: 'text-danger' },
  warning: { icon: <AlertTriangle className="h-4 w-4" />, accent: 'text-warning' },
  info: { icon: <Info className="h-4 w-4" />, accent: 'text-info' },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const timers = React.useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = React.useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const show = React.useCallback(
    (input: ToastInput) => {
      const id = nextId++;
      const toast: Toast = {
        id,
        tone: input.tone ?? 'info',
        title: input.title,
        description: input.description,
        action: input.action,
        duration: input.duration ?? (input.action ? 7000 : 4000),
      };
      // Keep the stack shallow so it never covers the screen.
      setToasts((prev) => [...prev.slice(-3), toast]);
      timers.current.set(id, setTimeout(() => dismiss(id), toast.duration));
      return id;
    },
    [dismiss],
  );

  React.useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((timer) => clearTimeout(timer));
      map.clear();
    };
  }, []);

  const api = React.useMemo<ToastApi>(
    () => ({
      show,
      dismiss,
      success: (title, description, action) => show({ title, description, action, tone: 'success' }),
      error: (title, description) => show({ title, description, tone: 'error', duration: 6000 }),
      info: (title, description, action) => show({ title, description, action, tone: 'info' }),
      warning: (title, description) => show({ title, description, tone: 'warning', duration: 5500 }),
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div
          className="pointer-events-none fixed inset-x-0 bottom-0 z-[120] flex flex-col items-center gap-2 p-4 pb-24 sm:bottom-auto sm:right-0 sm:top-0 sm:items-end sm:pb-4"
          role="region"
          aria-live="polite"
          aria-label="Notifications"
        >
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={cn(
                'pointer-events-auto flex w-full max-w-sm animate-slide-in-right items-start gap-3 rounded-xl border border-line bg-elevated p-3 shadow-pop',
              )}
            >
              <span className={cn('mt-0.5 shrink-0', TONE_META[toast.tone].accent)}>{TONE_META[toast.tone].icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-snug text-ink">{toast.title}</p>
                {toast.description && <p className="mt-0.5 text-xs leading-relaxed text-muted">{toast.description}</p>}
                {toast.action && (
                  <button
                    onClick={() => {
                      toast.action!.onClick();
                      dismiss(toast.id);
                    }}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-subtle px-2 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/10"
                  >
                    <Undo2 className="h-3 w-3" />
                    {toast.action.label}
                  </button>
                )}
              </div>
              <button
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss"
                className="-mr-0.5 -mt-0.5 shrink-0 rounded-lg p-1 text-faint transition-colors hover:bg-subtle hover:text-ink"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = React.useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}
