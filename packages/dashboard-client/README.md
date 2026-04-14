# @conveyor/dashboard-client

Typed HTTP + SSE client for the [Conveyor](https://github.com/eyolas/conveyor) dashboard API.
Runtime-agnostic: works in Deno, Node.js, Bun, and browsers.

## Installation

```bash
deno add jsr:@conveyor/dashboard-client
```

## Quick Start

```ts
import { ConveyorDashboardClient } from '@conveyor/dashboard-client';

const client = new ConveyorDashboardClient({
  baseUrl: 'http://localhost:8000',
});

// List all queues
const queues = await client.listQueues();

// Get jobs in a queue
const { data: jobs, meta } = await client.listJobs('emails', 'waiting', 0, 50);

// Add a job
const job = await client.addJob('emails', 'send', { to: 'user@example.com' });

// Subscribe to real-time events
const sub = client.subscribe({
  onEvent: (e) => console.log(e.type, e.queueName, e.jobId),
});
// later: sub.close();
```

## Authentication

```ts
// Token-based auth
const client = new ConveyorDashboardClient({
  baseUrl: 'http://localhost:8000/admin',
  headers: { Authorization: 'Bearer my-token' },
});
```

> **Note:** Native `EventSource` does not support custom headers. For SSE with token-based auth in
> non-browser runtimes, provide a custom `eventSourceFactory`:
>
> ```ts
> import EventSource from 'eventsource'; // npm polyfill that supports headers
>
> const client = new ConveyorDashboardClient({
>   baseUrl: 'http://localhost:8000',
>   headers: { Authorization: 'Bearer my-token' },
>   eventSourceFactory: (url) =>
>     new EventSource(url, { headers: { Authorization: 'Bearer my-token' } }),
> });
> ```

## API Reference

### Queues

| Method                           | Description                             |
| -------------------------------- | --------------------------------------- |
| `listQueues()`                   | List all queues with state counts       |
| `getQueue(name)`                 | Get queue detail (counts, paused names) |
| `pauseQueue(name, jobName?)`     | Pause a queue or specific job name      |
| `resumeQueue(name, jobName?)`    | Resume a queue or specific job name     |
| `drainQueue(name)`               | Remove all waiting jobs                 |
| `cleanQueue(name, state, grace)` | Clean jobs older than grace ms          |
| `retryAllJobs(name, state)`      | Retry all jobs in a state               |
| `promoteAllJobs(name)`           | Promote all delayed jobs                |
| `obliterateQueue(name, force?)`  | Delete queue and all jobs               |
| `getQueueGroups(name)`           | List groups with per-group counts       |

### Jobs

| Method                                 | Description            |
| -------------------------------------- | ---------------------- |
| `listJobs(queue, state, start?, end?)` | Paginated job list     |
| `getJob(queue, jobId)`                 | Single job detail      |
| `getJobChildren(queue, jobId)`         | Flow children          |
| `addJob(queue, name, data, opts?)`     | Create a job           |
| `retryJob(queue, jobId)`               | Retry a failed job     |
| `promoteJob(queue, jobId)`             | Promote a delayed job  |
| `cancelJob(queue, jobId)`              | Cancel an active job   |
| `removeJob(queue, jobId)`              | Delete a job           |
| `editJob(queue, jobId, updates)`       | Edit job data/priority |

### Search

| Method                          | Description                    |
| ------------------------------- | ------------------------------ |
| `searchJob(jobId)`              | Cross-queue job lookup by ID   |
| `searchByPayload(queue, query)` | Search jobs by payload content |
| `searchQueues(query)`           | Search queues by name          |

### Flows

| Method                    | Description           |
| ------------------------- | --------------------- |
| `listFlowParents(state?)` | List flow parent jobs |

### Metrics

| Method                                        | Description                   |
| --------------------------------------------- | ----------------------------- |
| `getMetrics(queue, granularity?, from?, to?)` | Query metrics buckets         |
| `getSparklines()`                             | Sparkline data for all queues |
| `getMetricsStatus()`                          | Check if metrics are enabled  |

### SSE Events

| Method               | Description                   |
| -------------------- | ----------------------------- |
| `subscribe(options)` | Subscribe to real-time events |

```ts
const sub = client.subscribe({
  queueName: 'emails',          // optional: omit for all queues
  onEvent: (e) => { ... },
  onError: (e) => { ... },      // optional
  eventTypes: ['job:completed'], // optional: filter event types
  reconnectDelay: 5000,          // optional: default 3000ms
});

sub.close(); // disconnect
```

## Error Handling

```ts
import { ConveyorApiError } from '@conveyor/dashboard-client';

try {
  await client.getJob('emails', 'nonexistent');
} catch (err) {
  if (err instanceof ConveyorApiError) {
    console.log(err.status); // 404
    console.log(err.code); // 'NOT_FOUND'
    console.log(err.message);
  }
}
```

## License

MIT
