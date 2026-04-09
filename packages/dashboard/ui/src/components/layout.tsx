import { useCallback, useEffect, useState } from 'preact/hooks';
import { getCurrentUrl } from 'preact-router';
import type { ComponentChildren } from 'preact';
import { Sidebar } from './sidebar';
import { ThemeToggle } from './theme-toggle';
import { CommandPalette } from './command-palette';
import { ToastContainer } from './toast';

function extractQueue(url: string): string | undefined {
  const match = url.match(/^\/queues\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]!) : undefined;
}

interface LayoutProps {
  children: ComponentChildren;
  url?: string;
}

export function Layout({ children, url }: LayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [cmdkOpen, setCmdkOpen] = useState(false);

  const activeQueue = extractQueue(url ?? getCurrentUrl());

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
        {/* Header */}
        <header class="flex h-14 items-center justify-between border-b border-slate-200 px-5 dark:border-border-dim">
          <a href="/" class="flex items-center gap-3 transition-opacity hover:opacity-80">
            {/* Logo */}
            <img src="/logo.jpeg" alt="Conveyor" class="h-7 w-7 rounded-lg object-cover" />
            <h1 class="font-display text-sm font-semibold tracking-tight text-slate-900 dark:text-text-bright">
              Conveyor
            </h1>
            <span class="hidden rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500 sm:inline dark:bg-surface-3 dark:text-text-muted">
              dashboard
            </span>
          </a>

          <div class="flex items-center gap-2">
            {/* Search trigger */}
            <button
              onClick={() => setCmdkOpen(true)}
              class="group flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-400 transition-all duration-200 hover:border-slate-300 hover:text-slate-600 dark:border-border-default dark:bg-surface-1 dark:text-text-muted dark:hover:border-border-bright dark:hover:text-text-secondary"
            >
              <svg
                class="h-3.5 w-3.5 transition-transform duration-200 group-hover:scale-110"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <span class="hidden sm:inline">Search...</span>
              <kbd class="hidden rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-400 sm:inline dark:border-border-default dark:bg-surface-2 dark:text-text-muted">
                {navigator.platform?.includes('Mac') ? '\u2318' : 'Ctrl'}K
              </kbd>
            </button>
            <ThemeToggle />
          </div>
        </header>

        {/* Main content */}
        <main class="flex-1 overflow-auto bg-slate-50/50 p-6 dark:bg-transparent">
          {children}
        </main>
      </div>

      <CommandPalette
        open={cmdkOpen}
        onClose={() => setCmdkOpen(false)}
        activeQueue={activeQueue}
      />
      <ToastContainer />
    </div>
  );
}
