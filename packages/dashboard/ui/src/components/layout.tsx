import { useCallback, useEffect, useState } from 'preact/hooks';
import { getCurrentUrl } from 'preact-router';
import type { ComponentChildren } from 'preact';
import { Sidebar } from './sidebar';
import { ThemeToggle } from './theme-toggle';
import { CommandPalette } from './command-palette';

interface LayoutProps {
  children: ComponentChildren;
}

export function Layout({ children }: LayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [cmdkOpen, setCmdkOpen] = useState(false);

  // Extract active queue from URL
  const url = getCurrentUrl();
  const queueMatch = url.match(/^\/queues\/([^/]+)/);
  const activeQueue = queueMatch ? decodeURIComponent(queueMatch[1]!) : undefined;

  // Cmd+K global shortcut
  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      setCmdkOpen((o) => !o);
    }
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown]);

  return (
    <div class="flex h-full">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((c) => !c)}
        activeQueue={activeQueue}
      />
      <div class="flex flex-1 flex-col overflow-hidden">
        <header class="flex items-center justify-between border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
          <div class="flex items-center gap-3">
            <h1 class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Conveyor</h1>
          </div>
          <div class="flex items-center gap-2">
            <button
              onClick={() => setCmdkOpen(true)}
              class="flex items-center gap-2 rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-300"
            >
              <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <span>Search...</span>
              <kbd class="rounded border border-zinc-300 px-1 py-0.5 text-xs dark:border-zinc-600">
                {navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'}K
              </kbd>
            </button>
            <ThemeToggle />
          </div>
        </header>
        <main class="flex-1 overflow-auto p-6">{children}</main>
      </div>
      <CommandPalette
        open={cmdkOpen}
        onClose={() => setCmdkOpen(false)}
        activeQueue={activeQueue}
      />
    </div>
  );
}
