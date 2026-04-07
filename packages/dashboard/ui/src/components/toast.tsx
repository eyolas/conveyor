import { useEffect, useState } from 'preact/hooks';

export interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error';
}

let nextId = 0;
let listener: ((toast: Toast) => void) | null = null;

export function showToast(message: string, type: 'success' | 'error' = 'success') {
  listener?.({ id: nextId++, message, type });
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    listener = (toast) => {
      setToasts((prev) => [...prev, toast]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, 3000);
    };
    return () => { listener = null; };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div class="fixed bottom-5 right-5 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          class={`animate-fade-in-scale flex items-center gap-2 rounded-xl border px-4 py-3 shadow-lg ${
            toast.type === 'success'
              ? 'border-teal/20 bg-white text-teal-dim dark:border-teal/15 dark:bg-surface-1 dark:text-teal'
              : 'border-rose/20 bg-white text-rose-dim dark:border-rose/15 dark:bg-surface-1 dark:text-rose'
          }`}
        >
          {toast.type === 'success' ? (
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
          <span class="font-display text-sm font-medium">{toast.message}</span>
        </div>
      ))}
    </div>
  );
}
