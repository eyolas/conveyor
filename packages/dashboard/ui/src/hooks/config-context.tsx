import { createContext, type ComponentChildren } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import { client, type DashboardConfig } from '../api/client';

const DEFAULT_CONFIG: DashboardConfig = { readOnly: false, authRequired: false };

const ConfigContext = createContext<DashboardConfig>(DEFAULT_CONFIG);

export function ConfigProvider({ children }: { children: ComponentChildren }) {
  const [config, setConfig] = useState<DashboardConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    let cancelled = false;
    client.getConfig()
      .then((c) => {
        if (!cancelled) setConfig(c);
      })
      .catch(() => {
        // Older backends without /api/config — keep defaults.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>;
}

export function useConfig(): DashboardConfig {
  return useContext(ConfigContext);
}
