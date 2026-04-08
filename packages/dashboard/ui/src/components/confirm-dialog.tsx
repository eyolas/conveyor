import { useCallback, useEffect, useRef } from 'preact/hooks';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  danger = true,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => confirmRef.current?.focus(), 50);
  }, [open]);

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onCancel();
  }, [onCancel]);

  useEffect(() => {
    if (!open) return;
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onKeyDown]);

  if (!open) return null;

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center" onClick={onCancel}>
      <div class="fixed inset-0 bg-black/40 backdrop-blur-sm dark:bg-black/60" />
      <div
        class="animate-fade-in-scale relative w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-border-default dark:bg-surface-1"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 class="font-display text-base font-semibold text-slate-900 dark:text-text-bright">
          {title}
        </h3>
        <p class="mt-2 text-sm leading-relaxed text-slate-500 dark:text-text-secondary">
          {message}
        </p>
        <div class="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            class="flex h-9 items-center rounded-lg border border-slate-200 px-4 font-display text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-border-default dark:text-text-secondary dark:hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            class={`flex h-9 items-center rounded-lg px-4 font-display text-xs font-semibold text-white transition-colors ${
              danger
                ? 'bg-rose-dim hover:bg-rose-600 dark:bg-rose-dim dark:hover:bg-rose-600'
                : 'bg-accent-dim hover:bg-accent dark:bg-accent-dim dark:hover:bg-accent'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
