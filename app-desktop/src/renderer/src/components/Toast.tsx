import { useState, useCallback, useEffect, createContext, useContext, useRef } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextVal {
  toast: (message: string, type?: ToastType, duration?: number) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
}

const ToastCtx = createContext<ToastContextVal>({
  toast: () => {}, success: () => {}, error: () => {}, info: () => {}, warning: () => {},
});

export function useToast() { return useContext(ToastCtx); }

const ICONS: Record<ToastType, string> = {
  success: 'OK', error: '', info: 'ℹ', warning: '!',
};
const COLORS: Record<ToastType, string> = {
  success: 'bg-green-600', error: 'bg-red-600', info: 'bg-blue-600', warning: 'bg-amber-500',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const remove = useCallback((id: string) => {
    setToasts(t => t.filter(x => x.id !== id));
  }, []);

  const toast = useCallback((message: string, type: ToastType = 'info', duration = 3500) => {
    const id = `t${++counter.current}`;
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => remove(id), duration);
  }, [remove]);

  const success = useCallback((m: string) => toast(m, 'success'), [toast]);
  const error   = useCallback((m: string) => toast(m, 'error', 5000), [toast]);
  const info    = useCallback((m: string) => toast(m, 'info'), [toast]);
  const warning = useCallback((m: string) => toast(m, 'warning', 4000), [toast]);

  return (
    <ToastCtx.Provider value={{ toast, success, error, info, warning }}>
      {children}
      {/* Toast container */}
      <div className="fixed top-20 right-4 z-[10000] space-y-2 pointer-events-none" aria-live="polite">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg text-white shadow-lg text-sm font-medium
              pointer-events-auto max-w-sm animate-in slide-in-from-right duration-300 ${COLORS[t.type]}`}
          >
            <span className="text-base">{ICONS[t.type]}</span>
            <span className="flex-1">{t.message}</span>
            <button
              onClick={() => remove(t.id)}
              className="ml-2 opacity-70 hover:opacity-100 text-lg leading-none"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
