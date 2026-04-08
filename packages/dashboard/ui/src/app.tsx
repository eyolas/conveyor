import { useState } from 'preact/hooks';
import Router, { getCurrentUrl } from 'preact-router';
import { Layout } from './components/layout';
import { HomePage } from './pages/home';
import { QueuePage } from './pages/queue';
import { JobPage } from './pages/job';

export function App() {
  const [url, setUrl] = useState(getCurrentUrl());

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
