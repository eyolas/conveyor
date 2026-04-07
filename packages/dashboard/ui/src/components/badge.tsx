const COLORS: Record<string, string> = {
  waiting: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  'waiting-children': 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  active: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  delayed: 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300',
  paused: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
};

export function Badge({ state, count }: { state: string; count?: number }) {
  const color = COLORS[state] ?? 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300';
  return (
    <span class={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${color}`}>
      {state}
      {count !== undefined && <span class="font-mono">{count}</span>}
    </span>
  );
}
