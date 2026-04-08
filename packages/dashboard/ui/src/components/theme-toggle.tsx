import { useTheme } from '../hooks/use-theme';

export function ThemeToggle() {
  const { effective, setTheme } = useTheme();
  const isDark = effective === 'dark';

  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      class="group relative flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-all duration-200 hover:bg-surface-3 hover:text-text-primary dark:hover:bg-surface-3 bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700"
      title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
    >
      <div class="relative h-4 w-4">
        {/* Sun */}
        <svg
          class={`absolute inset-0 h-4 w-4 transition-all duration-300 ${isDark ? 'rotate-0 scale-100 opacity-100' : 'rotate-90 scale-0 opacity-0'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
          />
        </svg>
        {/* Moon */}
        <svg
          class={`absolute inset-0 h-4 w-4 transition-all duration-300 ${isDark ? '-rotate-90 scale-0 opacity-0' : 'rotate-0 scale-100 opacity-100'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
          />
        </svg>
      </div>
    </button>
  );
}
