const STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  waiting: {
    bg: 'bg-sky-glow dark:bg-sky-glow bg-sky-50',
    text: 'text-sky-700 dark:text-sky',
    dot: 'bg-sky-500 dark:bg-sky',
  },
  'waiting-children': {
    bg: 'bg-violet-glow dark:bg-violet-glow bg-violet-50',
    text: 'text-violet-700 dark:text-violet',
    dot: 'bg-violet-500 dark:bg-violet',
  },
  active: {
    bg: 'bg-amber-glow dark:bg-amber-glow bg-amber-50',
    text: 'text-amber-700 dark:text-amber',
    dot: 'bg-amber-500 dark:bg-amber',
  },
  completed: {
    bg: 'bg-teal-glow dark:bg-teal-glow bg-emerald-50',
    text: 'text-emerald-700 dark:text-teal',
    dot: 'bg-emerald-500 dark:bg-teal',
  },
  failed: {
    bg: 'bg-rose-glow dark:bg-rose-glow bg-rose-50',
    text: 'text-rose-700 dark:text-rose',
    dot: 'bg-rose-500 dark:bg-rose',
  },
  delayed: {
    bg: 'bg-slate-100 dark:bg-surface-3',
    text: 'text-slate-600 dark:text-text-secondary',
    dot: 'bg-slate-400 dark:bg-text-muted',
  },
  paused: {
    bg: 'bg-amber-glow dark:bg-amber-glow bg-orange-50',
    text: 'text-orange-700 dark:text-amber',
    dot: 'bg-orange-500 dark:bg-amber',
  },
};

export function Badge({ state, count }: { state: string; count?: number }) {
  const style = STYLES[state] ?? STYLES.delayed!;
  return (
    <span
      class={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-display text-[11px] font-medium tracking-wide uppercase ${style.bg} ${style.text}`}
    >
      <span class={`inline-block h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {state}
      {count !== undefined && (
        <span class="font-mono font-semibold tabular-nums">{count}</span>
      )}
    </span>
  );
}
