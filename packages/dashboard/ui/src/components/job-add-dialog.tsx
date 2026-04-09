import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { addJob } from '../api/client';
import { tryFixJson } from '../utils/json-fix';
import { showToast } from './toast';

interface JobAddDialogProps {
  open: boolean;
  queueName: string;
  onClose: () => void;
  onAdded: () => void;
}

export function JobAddDialog({ open, queueName, onClose, onAdded }: JobAddDialogProps) {
  const [name, setName] = useState('');
  const [payload, setPayload] = useState('{}');
  const [delay, setDelay] = useState('');
  const [priority, setPriority] = useState('');
  const [attempts, setAttempts] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setPayload('{}');
    setDelay('');
    setPriority('');
    setAttempts('');
    setJsonError(null);
    const timer = setTimeout(() => nameRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [open]);

  const validateJson = useCallback((value: string) => {
    try {
      JSON.parse(value);
      setJsonError(null);
      return true;
    } catch (e) {
      setJsonError((e as Error).message);
      return false;
    }
  }, []);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onKeyDown]);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    if (!validateJson(payload)) return;

    const data = JSON.parse(payload);
    const opts: Record<string, unknown> = {};
    if (delay.trim()) opts.delay = delay.trim();
    if (priority.trim()) {
      const p = parseInt(priority, 10);
      if (!isNaN(p)) opts.priority = p;
    }
    if (attempts.trim()) {
      const a = parseInt(attempts, 10);
      if (!isNaN(a) && a >= 1) opts.attempts = a;
    }

    setSubmitting(true);
    try {
      await addJob(queueName, name.trim(), data, opts);
      showToast('Job added');
      onAdded();
      onClose();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div class="fixed inset-0 bg-black/40 backdrop-blur-sm dark:bg-black/60" />
      <div
        class="animate-fade-in-scale relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-border-default dark:bg-surface-1"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 class="font-display text-base font-semibold text-slate-900 dark:text-text-bright">
          Add Job to {queueName}
        </h3>

        <div class="mt-4 space-y-4">
          {/* Job name */}
          <div>
            <label class="mb-1 block font-display text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
              Name <span class="text-rose">*</span>
            </label>
            <input
              ref={nameRef}
              type="text"
              value={name}
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
              placeholder="send-email"
              class="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm text-slate-900 placeholder-slate-400 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 dark:border-border-default dark:bg-surface-2 dark:text-text-primary dark:placeholder-text-muted"
            />
          </div>

          {/* Payload */}
          <div>
            <label class="mb-1 block font-display text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
              Payload (JSON)
            </label>
            <textarea
              value={payload}
              onInput={(e) => {
                const val = (e.target as HTMLTextAreaElement).value;
                setPayload(val);
                validateJson(val);
              }}
              rows={5}
              class={`w-full rounded-lg border bg-white px-3 py-2 font-mono text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 dark:bg-surface-2 dark:text-text-primary ${
                jsonError
                  ? 'border-rose focus:border-rose focus:ring-rose/30'
                  : 'border-slate-200 focus:border-accent focus:ring-accent/30 dark:border-border-default'
              }`}
            />
            {jsonError && (
              <div class="mt-1 flex items-center gap-2">
                <p class="flex-1 font-mono text-[11px] text-rose">{jsonError}</p>
                {tryFixJson(payload) !== null && (
                  <button
                    type="button"
                    onClick={() => {
                      const fixed = tryFixJson(payload);
                      if (fixed) {
                        setPayload(fixed);
                        setJsonError(null);
                      }
                    }}
                    class="flex-shrink-0 rounded-md bg-accent/10 px-2 py-1 font-display text-[10px] font-semibold text-accent transition-colors hover:bg-accent/20 dark:bg-accent-glow dark:text-accent-bright"
                  >
                    Fix JSON
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Options row */}
          <div class="grid grid-cols-3 gap-3">
            <div>
              <label class="mb-1 block font-display text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
                Delay
              </label>
              <input
                type="text"
                value={delay}
                onInput={(e) => setDelay((e.target as HTMLInputElement).value)}
                placeholder="10s, 5m"
                class="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm text-slate-900 placeholder-slate-400 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 dark:border-border-default dark:bg-surface-2 dark:text-text-primary dark:placeholder-text-muted"
              />
            </div>
            <div>
              <label class="mb-1 block font-display text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
                Priority
              </label>
              <input
                type="number"
                value={priority}
                onInput={(e) => setPriority((e.target as HTMLInputElement).value)}
                placeholder="0"
                class="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm text-slate-900 placeholder-slate-400 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 dark:border-border-default dark:bg-surface-2 dark:text-text-primary dark:placeholder-text-muted"
              />
            </div>
            <div>
              <label class="mb-1 block font-display text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
                Attempts
              </label>
              <input
                type="number"
                value={attempts}
                onInput={(e) => setAttempts((e.target as HTMLInputElement).value)}
                placeholder="1"
                min="1"
                class="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm text-slate-900 placeholder-slate-400 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 dark:border-border-default dark:bg-surface-2 dark:text-text-primary dark:placeholder-text-muted"
              />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div class="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            class="flex h-9 items-center rounded-lg border border-slate-200 px-4 font-display text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-border-default dark:text-text-secondary dark:hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim() || !!jsonError || submitting}
            class="flex h-9 items-center rounded-lg bg-accent-dim px-4 font-display text-xs font-semibold text-white transition-colors hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed dark:bg-accent-dim dark:hover:bg-accent"
          >
            {submitting ? 'Adding...' : 'Add Job'}
          </button>
        </div>
      </div>
    </div>
  );
}
