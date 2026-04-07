import { useCallback, useEffect, useState } from 'preact/hooks';

type Theme = 'light' | 'dark' | 'system';

function getEffectiveTheme(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(effective: 'light' | 'dark') {
  document.documentElement.classList.toggle('dark', effective === 'dark');
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem('theme');
    return (stored as Theme) ?? 'system';
  });

  const effective = getEffectiveTheme(theme);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    if (t === 'system') {
      localStorage.removeItem('theme');
    } else {
      localStorage.setItem('theme', t);
    }
    applyTheme(getEffectiveTheme(t));
  }, []);

  useEffect(() => {
    applyTheme(effective);
    if (theme !== 'system') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme(getEffectiveTheme('system'));
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme, effective]);

  return { theme, effective, setTheme };
}
