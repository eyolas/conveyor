import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import Router, { getCurrentUrl } from 'preact-router';
import { Layout } from './components/layout';
import { ConfigProvider } from './hooks/config-context';
import {
  LiveUpdatesContext,
} from './hooks/live-updates-context';
import { useLiveUpdates } from './hooks/use-live-updates';
import { FlowDetailPage } from './pages/flow-detail';
import { FlowsPage } from './pages/flows';
import { HomePage } from './pages/home';
import { QueuePage } from './pages/queue';
import { JobPage } from './pages/job';
import { SearchPage } from './pages/search';

export function App() {
  const [url, setUrl] = useState(getCurrentUrl());
  const { liveUpdates, toggleLiveUpdates } = useLiveUpdates();
  const refreshCallbacks = useRef<Set<() => void>>(new Set());

  useEffect(() => {
    const onPopState = () => setUrl(getCurrentUrl());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const refresh = useCallback(() => {
    for (const cb of refreshCallbacks.current) cb();
  }, []);

  const onRefresh = useCallback((cb: () => void) => {
    refreshCallbacks.current.add(cb);
    return () => refreshCallbacks.current.delete(cb);
  }, []);

  return (
    <ConfigProvider>
      <LiveUpdatesContext.Provider
        value={{ liveUpdates, toggleLiveUpdates, refresh, onRefresh }}
      >
        <Layout url={url}>
          <Router onChange={(e) => setUrl(e.url)}>
            <SearchPage path="/search" />
            <FlowsPage path="/flows" />
            <FlowDetailPage path="/flows/:name/:id" />
            <JobPage path="/queues/:name/jobs/:id" />
            <QueuePage path="/queues/:name" />
            <HomePage path="/" />
          </Router>
        </Layout>
      </LiveUpdatesContext.Provider>
    </ConfigProvider>
  );
}
