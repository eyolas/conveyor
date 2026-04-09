import { useEffect, useState } from 'preact/hooks';
import Router, { getCurrentUrl } from 'preact-router';
import { Layout } from './components/layout';
import { HomePage } from './pages/home';
import { QueuePage } from './pages/queue';
import { JobPage } from './pages/job';

export function App() {
  const [url, setUrl] = useState(getCurrentUrl());

  // Also listen for browser back/forward (popstate) which preact-router
  // onChange doesn't catch
  useEffect(() => {
    const onPopState = () => setUrl(getCurrentUrl());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return (
    <Layout url={url}>
      <Router onChange={(e) => setUrl(e.url)}>
        <HomePage path="/" />
        <QueuePage path="/queues/:name" />
        <JobPage path="/queues/:name/jobs/:id" />
      </Router>
    </Layout>
  );
}
