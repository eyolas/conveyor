import Router from 'preact-router';
import { Layout } from './components/layout';
import { HomePage } from './pages/home';
import { QueuePage } from './pages/queue';
import { JobPage } from './pages/job';

export function App() {
  return (
    <Layout>
      <Router>
        <HomePage path="/" />
        <QueuePage path="/queues/:name" />
        <JobPage path="/queues/:name/jobs/:id" />
      </Router>
    </Layout>
  );
}
