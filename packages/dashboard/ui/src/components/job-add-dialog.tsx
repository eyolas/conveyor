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

type BackoffType = '' | 'fixed' | 'exponential';
type RepeatMode = 'none' | 'cron' | 'every';

function parseIntInput(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const n = parseInt(trimmed, 10);
  return Number.isNaN(n) ? undefined : n;
}

function parseRemoveOn(value: string): boolean | number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  const n = parseInt(trimmed, 10);
  return Number.isNaN(n) ? undefined : n;
}

export function JobAddDialog({ open, queueName, onClose, onAdded }: JobAddDialogProps) {
  const [name, setName] = useState('');
  const [payload, setPayload] = useState('{}');
  const [delay, setDelay] = useState('');
  const [priority, setPriority] = useState('');
  const [attempts, setAttempts] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Advanced
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [jobId, setJobId] = useState('');
  const [lifo, setLifo] = useState(false);
  const [backoffType, setBackoffType] = useState<BackoffType>('');
  const [backoffDelay, setBackoffDelay] = useState('');
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('none');
  const [repeatCron, setRepeatCron] = useState('');
  const [repeatEvery, setRepeatEvery] = useState('');
  const [repeatLimit, setRepeatLimit] = useState('');
  const [repeatTz, setRepeatTz] = useState('');
  const [dedupKey, setDedupKey] = useState('');
  const [dedupHash, setDedupHash] = useState(false);
  const [dedupTtl, setDedupTtl] = useState('');
  const [removeOnComplete, setRemoveOnComplete] = useState('');
  const [removeOnFail, setRemoveOnFail] = useState('');
  const [timeoutMs, setTimeoutMs] = useState('');

  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setPayload('{}');
    setDelay('');
    setPriority('');
    setAttempts('');
    setJsonError(null);
    setShowAdvanced(false);
    setJobId('');
    setLifo(false);
    setBackoffType('');
    setBackoffDelay('');
    setRepeatMode('none');
    setRepeatCron('');
    setRepeatEvery('');
    setRepeatLimit('');
    setRepeatTz('');
    setDedupKey('');
    setDedupHash(false);
    setDedupTtl('');
    setRemoveOnComplete('');
    setRemoveOnFail('');
    setTimeoutMs('');
    const timer = window.setTimeout(() => nameRef.current?.focus(), 50);
    return () => window.clearTimeout(timer);
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

  const buildOpts = (): Record<string, unknown> => {
    const opts: Record<string, unknown> = {};
    if (delay.trim()) opts.delay = delay.trim();
    const p = parseIntInput(priority);
    if (p !== undefined) opts.priority = p;
    const a = parseIntInput(attempts);
    if (a !== undefined && a >= 1) opts.attempts = a;

    if (jobId.trim()) opts.jobId = jobId.trim();
    if (lifo) opts.lifo = true;

    if (backoffType) {
      const bd = parseIntInput(backoffDelay);
      if (bd !== undefined) opts.backoff = { type: backoffType, delay: bd };
    }

    if (repeatMode !== 'none') {
      const repeat: Record<string, unknown> = {};
      if (repeatMode === 'cron' && repeatCron.trim()) repeat.cron = repeatCron.trim();
      if (repeatMode === 'every' && repeatEvery.trim()) repeat.every = repeatEvery.trim();
      const rl = parseIntInput(repeatLimit);
      if (rl !== undefined) repeat.limit = rl;
      if (repeatTz.trim()) repeat.tz = repeatTz.trim();
      if (Object.keys(repeat).length > 0) opts.repeat = repeat;
    }

    if (dedupKey.trim() || dedupHash) {
      const dedup: Record<string, unknown> = {};
      if (dedupKey.trim()) dedup.key = dedupKey.trim();
      if (dedupHash) dedup.hash = true;
      const ttl = parseIntInput(dedupTtl);
      if (ttl !== undefined) dedup.ttl = ttl;
      opts.deduplication = dedup;
    }

    const roc = parseRemoveOn(removeOnComplete);
    if (roc !== undefined) opts.removeOnComplete = roc;
    const rof = parseRemoveOn(removeOnFail);
    if (rof !== undefined) opts.removeOnFail = rof;

    const t = parseIntInput(timeoutMs);
    if (t !== undefined) opts.timeout = t;

    return opts;
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;
    if (!validateJson(payload)) return;

    const data = JSON.parse(payload);
    setSubmitting(true);
    try {
      await addJob(queueName, name.trim(), data, buildOpts());
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
        class="animate-fade-in-scale relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-border-default dark:bg-surface-1"
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

          {/* Basic options row */}
          <div class="grid grid-cols-3 gap-3">
            <Field label="Delay" value={delay} onChange={setDelay} placeholder="10s, 5m" />
            <Field label="Priority" value={priority} onChange={setPriority} placeholder="0" type="number" />
            <Field label="Attempts" value={attempts} onChange={setAttempts} placeholder="1" type="number" />
          </div>

          {/* Advanced toggle */}
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            class="flex items-center gap-1.5 font-display text-[11px] font-semibold uppercase tracking-wider text-slate-500 transition-colors hover:text-slate-700 dark:text-text-muted dark:hover:text-text-secondary"
          >
            <svg
              class={`h-3 w-3 transition-transform ${showAdvanced ? 'rotate-90' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2.5"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            Advanced
          </button>

          {showAdvanced && (
            <div class="space-y-3 rounded-lg border border-slate-200 bg-slate-50/50 p-3 dark:border-border-dim dark:bg-surface-2/30">
              <div class="grid grid-cols-2 gap-3">
                <Field
                  label="Job ID"
                  value={jobId}
                  onChange={setJobId}
                  placeholder="manual-id"
                />
                <label class="flex items-end gap-2 pb-2">
                  <input
                    type="checkbox"
                    checked={lifo}
                    onInput={(e) => setLifo((e.target as HTMLInputElement).checked)}
                    class="h-3.5 w-3.5 rounded border-slate-300 text-accent focus:ring-accent/30 dark:border-border-default dark:bg-surface-2"
                  />
                  <span class="font-display text-xs font-medium text-slate-600 dark:text-text-secondary">
                    LIFO
                  </span>
                </label>
              </div>

              {/* Backoff */}
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="mb-1 block font-display text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
                    Backoff
                  </label>
                  <select
                    value={backoffType}
                    onChange={(e) =>
                      setBackoffType((e.target as HTMLSelectElement).value as BackoffType)}
                    class="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 font-mono text-sm text-slate-900 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 dark:border-border-default dark:bg-surface-2 dark:text-text-primary"
                  >
                    <option value="">none</option>
                    <option value="fixed">fixed</option>
                    <option value="exponential">exponential</option>
                  </select>
                </div>
                <Field
                  label="Backoff Delay (ms)"
                  value={backoffDelay}
                  onChange={setBackoffDelay}
                  placeholder="1000"
                  type="number"
                  disabled={!backoffType}
                />
              </div>

              {/* Repeat */}
              <div>
                <label class="mb-1 block font-display text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
                  Repeat
                </label>
                <div class="flex gap-2">
                  <select
                    value={repeatMode}
                    onChange={(e) =>
                      setRepeatMode((e.target as HTMLSelectElement).value as RepeatMode)}
                    class="h-9 rounded-lg border border-slate-200 bg-white px-2 font-mono text-sm text-slate-900 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 dark:border-border-default dark:bg-surface-2 dark:text-text-primary"
                  >
                    <option value="none">none</option>
                    <option value="cron">cron</option>
                    <option value="every">every</option>
                  </select>
                  {repeatMode === 'cron' && (
                    <input
                      type="text"
                      value={repeatCron}
                      onInput={(e) => setRepeatCron((e.target as HTMLInputElement).value)}
                      placeholder="*/5 * * * *"
                      class="h-9 flex-1 rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm text-slate-900 placeholder-slate-400 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 dark:border-border-default dark:bg-surface-2 dark:text-text-primary dark:placeholder-text-muted"
                    />
                  )}
                  {repeatMode === 'every' && (
                    <input
                      type="text"
                      value={repeatEvery}
                      onInput={(e) => setRepeatEvery((e.target as HTMLInputElement).value)}
                      placeholder="5m, 1h"
                      class="h-9 flex-1 rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm text-slate-900 placeholder-slate-400 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 dark:border-border-default dark:bg-surface-2 dark:text-text-primary dark:placeholder-text-muted"
                    />
                  )}
                </div>
                {repeatMode !== 'none' && (
                  <div class="mt-2 grid grid-cols-2 gap-3">
                    <Field
                      label="Limit"
                      value={repeatLimit}
                      onChange={setRepeatLimit}
                      placeholder="unlimited"
                      type="number"
                    />
                    <Field
                      label="Timezone"
                      value={repeatTz}
                      onChange={setRepeatTz}
                      placeholder="UTC"
                    />
                  </div>
                )}
              </div>

              {/* Dedup */}
              <div class="grid grid-cols-[1fr_1fr_auto] gap-3">
                <Field
                  label="Dedup Key"
                  value={dedupKey}
                  onChange={setDedupKey}
                  placeholder="order-123"
                />
                <Field
                  label="Dedup TTL (ms)"
                  value={dedupTtl}
                  onChange={setDedupTtl}
                  placeholder="60000"
                  type="number"
                />
                <label class="flex items-end gap-2 pb-2">
                  <input
                    type="checkbox"
                    checked={dedupHash}
                    onInput={(e) => setDedupHash((e.target as HTMLInputElement).checked)}
                    class="h-3.5 w-3.5 rounded border-slate-300 text-accent focus:ring-accent/30 dark:border-border-default dark:bg-surface-2"
                  />
                  <span class="font-display text-xs font-medium text-slate-600 dark:text-text-secondary">
                    Hash
                  </span>
                </label>
              </div>

              {/* Remove + timeout */}
              <div class="grid grid-cols-3 gap-3">
                <Field
                  label="Remove on Complete"
                  value={removeOnComplete}
                  onChange={setRemoveOnComplete}
                  placeholder="true / 60000"
                />
                <Field
                  label="Remove on Fail"
                  value={removeOnFail}
                  onChange={setRemoveOnFail}
                  placeholder="true / 60000"
                />
                <Field
                  label="Timeout (ms)"
                  value={timeoutMs}
                  onChange={setTimeoutMs}
                  placeholder="30000"
                  type="number"
                />
              </div>
            </div>
          )}
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

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'number';
  disabled?: boolean;
}

function Field({ label, value, onChange, placeholder, type = 'text', disabled }: FieldProps) {
  return (
    <div>
      <label class="mb-1 block font-display text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-text-muted">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onInput={(e) => onChange((e.target as HTMLInputElement).value)}
        placeholder={placeholder}
        disabled={disabled}
        class="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm text-slate-900 placeholder-slate-400 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-50 dark:border-border-default dark:bg-surface-2 dark:text-text-primary dark:placeholder-text-muted"
      />
    </div>
  );
}
