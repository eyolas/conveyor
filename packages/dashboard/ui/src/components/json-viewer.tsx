import { useState } from 'preact/hooks';

function JsonNode({ name, value, depth = 0 }: { name?: string; value: unknown; depth?: number }) {
  const [collapsed, setCollapsed] = useState(depth > 2);

  const nameEl = name !== undefined
    ? <span class="text-violet dark:text-violet">{name}</span>
    : null;
  const separator = name !== undefined
    ? <span class="text-slate-400 dark:text-text-muted">: </span>
    : null;

  if (value === null) {
    return (
      <span>
        {nameEl}{separator}
        <span class="italic text-slate-400 dark:text-text-muted">null</span>
      </span>
    );
  }

  if (typeof value === 'string') {
    return (
      <span>
        {nameEl}{separator}
        <span class="text-teal-600 dark:text-teal">"{value}"</span>
      </span>
    );
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return (
      <span>
        {nameEl}{separator}
        <span class="text-amber-600 dark:text-amber">{String(value)}</span>
      </span>
    );
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <span>
          {nameEl}{separator}
          <span class="text-slate-400 dark:text-text-muted">[]</span>
        </span>
      );
    }
    return (
      <div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          class="group inline-flex items-center gap-1 text-slate-500 hover:text-slate-700 dark:text-text-muted dark:hover:text-text-secondary"
        >
          <svg
            class={`h-3 w-3 transition-transform duration-150 ${collapsed ? '' : 'rotate-90'}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          {nameEl}{separator}
          {collapsed
            ? <span class="text-slate-400 dark:text-text-muted">[<span class="text-xs">{value.length} items</span>]</span>
            : <span class="text-slate-400 dark:text-text-muted">[</span>}
        </button>
        {!collapsed && (
          <div class="ml-4 border-l border-slate-200 pl-3 dark:border-border-dim">
            {value.map((item, i) => (
              <div key={i} class="py-0.5">
                <JsonNode name={String(i)} value={item} depth={depth + 1} />
              </div>
            ))}
            <span class="text-slate-400 dark:text-text-muted">]</span>
          </div>
        )}
      </div>
    );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return (
        <span>
          {nameEl}{separator}
          <span class="text-slate-400 dark:text-text-muted">{'{}'}</span>
        </span>
      );
    }
    return (
      <div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          class="group inline-flex items-center gap-1 text-slate-500 hover:text-slate-700 dark:text-text-muted dark:hover:text-text-secondary"
        >
          <svg
            class={`h-3 w-3 transition-transform duration-150 ${collapsed ? '' : 'rotate-90'}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          {nameEl}{separator}
          {collapsed
            ? <span class="text-slate-400 dark:text-text-muted">{'{'}<span class="text-xs">{entries.length} keys</span>{'}'}</span>
            : <span class="text-slate-400 dark:text-text-muted">{'{'}</span>}
        </button>
        {!collapsed && (
          <div class="ml-4 border-l border-slate-200 pl-3 dark:border-border-dim">
            {entries.map(([key, val]) => (
              <div key={key} class="py-0.5">
                <JsonNode name={key} value={val} depth={depth + 1} />
              </div>
            ))}
            <span class="text-slate-400 dark:text-text-muted">{'}'}</span>
          </div>
        )}
      </div>
    );
  }

  return <span class="text-slate-600 dark:text-text-secondary">{String(value)}</span>;
}

export function JsonViewer({ data }: { data: unknown }) {
  return (
    <div class="overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-5 font-mono text-[13px] leading-relaxed dark:border-border-dim dark:bg-surface-2">
      <JsonNode value={data} />
    </div>
  );
}
