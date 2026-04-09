import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import Router, { getCurrentUrl } from 'preact-router';
import { Layout } from './components/layout';
import {
  LiveUpdatesContext,
} from './hooks/live-updates-context';
import { useLiveUpdates } from './hooks/use-live-updates';
import { HomePage } from './pages/home';
import { QueuePage } from './pages/queue';
import { JobPage } from './pages/job';

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
    <LiveUpdatesContext.Provider
      value={{ liveUpdates, toggleLiveUpdates, refresh, onRefresh }}
    >
      <Layout url={url}>
        <Router onChange={(e) => setUrl(e.url)}>
          <HomePage path="/" />
          <QueuePage path="/queues/:name" />
          <JobPage path="/queues/:name/jobs/:id" />
        </Router>
      </Layout>
    </LiveUpdatesContext.Provider>
  );
}
