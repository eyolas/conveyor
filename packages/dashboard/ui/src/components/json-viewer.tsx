import { useState } from 'preact/hooks';

function JsonNode({ name, value, depth = 0 }: { name?: string; value: unknown; depth?: number }) {
  const [collapsed, setCollapsed] = useState(depth > 2);

  if (value === null) {
    return (
      <span>
        {name && <span class="text-zinc-500 dark:text-zinc-400">{name}: </span>}
        <span class="text-zinc-400 italic">null</span>
      </span>
    );
  }

  if (typeof value === 'string') {
    return (
      <span>
        {name && <span class="text-zinc-500 dark:text-zinc-400">{name}: </span>}
        <span class="text-emerald-600 dark:text-emerald-400">"{value}"</span>
      </span>
    );
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return (
      <span>
        {name && <span class="text-zinc-500 dark:text-zinc-400">{name}: </span>}
        <span class="text-blue-600 dark:text-blue-400">{String(value)}</span>
      </span>
    );
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <span>
          {name && <span class="text-zinc-500 dark:text-zinc-400">{name}: </span>}
          <span class="text-zinc-400">[]</span>
        </span>
      );
    }
    return (
      <div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          class="text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          {name && <span>{name}: </span>}
          {collapsed ? `[...] (${value.length})` : '['}
        </button>
        {!collapsed && (
          <div class="ml-4 border-l border-zinc-200 pl-2 dark:border-zinc-700">
            {value.map((item, i) => (
              <div key={i}>
                <JsonNode name={String(i)} value={item} depth={depth + 1} />
              </div>
            ))}
            <span class="text-zinc-500">]</span>
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
          {name && <span class="text-zinc-500 dark:text-zinc-400">{name}: </span>}
          <span class="text-zinc-400">{'{}'}</span>
        </span>
      );
    }
    return (
      <div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          class="text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          {name && <span>{name}: </span>}
          {collapsed ? `{...} (${entries.length})` : '{'}
        </button>
        {!collapsed && (
          <div class="ml-4 border-l border-zinc-200 pl-2 dark:border-zinc-700">
            {entries.map(([key, val]) => (
              <div key={key}>
                <JsonNode name={key} value={val} depth={depth + 1} />
              </div>
            ))}
            <span class="text-zinc-500">{'}'}</span>
          </div>
        )}
      </div>
    );
  }

  return <span>{String(value)}</span>;
}

export function JsonViewer({ data }: { data: unknown }) {
  return (
    <div class="overflow-auto rounded-lg border border-zinc-200 bg-zinc-50 p-4 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900">
      <JsonNode value={data} />
    </div>
  );
}
