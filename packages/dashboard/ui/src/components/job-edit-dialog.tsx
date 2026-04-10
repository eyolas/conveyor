import { useCallback, useEffect, useState } from 'preact/hooks';
import type { JobData } from '../api/client';
import { editJob } from '../api/client';
import { tryFixJson } from '../utils/json-fix';
import { showToast } from './toast';

interface JobEditDialogProps {
  open: boolean;
  job: JobData;
  queueName: string;
  onClose: () => void;
  onSaved: () => void;
}

export function JobEditDialog({
  open,
  job,
  queueName,
  onClose,
  onSaved,
}: JobEditDialogProps) {
  const [payload, setPayload] = useState('');
  const [priority, setPriority] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPayload(JSON.stringify(job.data, null, 2));
    setPriority(String(job.opts.priority ?? 0));
    setJsonError(null);
  }, [open, job]);

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
    if (!validateJson(payload)) return;

    const data = JSON.parse(payload);
    const opts: { priority?: number } = {};
    if (priority.trim()) opts.priority = parseInt(priority, 10);

    setSubmitting(true);
    try {
      await editJob(queueName, job.id, { data, opts });
      showToast('Job updated');
      onSaved();
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
          Edit Job
        </h3>
        <p class="mt-1 font-mono text-xs text-slate-400 dark:text-text-muted">
          {job.name} &middot; {job.id.slice(0, 8)}
        </p>

        <div class="mt-4 space-y-4">
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
              rows={8}
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

          {/* Priority */}
          <div>
            <label class="mb-1 block font-display text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
              Priority
            </label>
            <input
              type="number"
              value={priority}
              onInput={(e) => setPriority((e.target as HTMLInputElement).value)}
              class="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm text-slate-900 placeholder-slate-400 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 dark:border-border-default dark:bg-surface-2 dark:text-text-primary dark:placeholder-text-muted"
            />
            <p class="mt-1 text-[11px] text-slate-400 dark:text-text-muted">
              Lower number = higher priority
            </p>
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
            disabled={!!jsonError || submitting}
            class="flex h-9 items-center rounded-lg bg-accent-dim px-4 font-display text-xs font-semibold text-white transition-colors hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed dark:bg-accent-dim dark:hover:bg-accent"
          >
            {submitting ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
