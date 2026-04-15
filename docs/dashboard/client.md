# Dashboard Client

`@conveyor/dashboard-client` is a typed HTTP + SSE client for the Conveyor dashboard API. Use it to
build custom integrations, CLI tools, or alternative UIs without depending on the bundled dashboard.

- Runtime-agnostic: Deno, Node.js, Bun, and browsers
- Zero external dependencies (only `@conveyor/shared` for types)
- Full TypeScript types for all API responses

## Installation

::: code-group

```sh [Deno]
deno add jsr:@conveyor/dashboard-client
```

```sh [npm]
npx jsr add @conveyor/dashboard-client
```

```sh [pnpm]
pnpm dlx jsr add @conveyor/dashboard-client
```

```sh [Bun]
bunx jsr add @conveyor/dashboard-client
```

:::

## Quick Start

```typescript
import { ConveyorDashboardClient } from '@conveyor/dashboard-client';

const client = new ConveyorDashboardClient({
  baseUrl: 'http://localhost:3000',
});

// List all queues
const queues = await client.listQueues();
console.log(queues);

// Get jobs in a queue
const { data: jobs, meta } = await client.listJobs('emails', 'waiting', 0, 50);

// Add a job
const job = await client.addJob('emails', 'send', { to: 'user@example.com' });
```

## Configuration

```typescript
const client = new ConveyorDashboardClient({
  // Base URL of the dashboard API
  baseUrl: 'http://localhost:3000/admin',

  // Extra headers for every request (auth tokens, etc.)
  headers: { Authorization: 'Bearer my-token' },

  // Custom fetch implementation (optional)
  fetch: customFetch,

  // Custom EventSource factory for SSE with auth (optional)
  eventSourceFactory: (url) => new EventSource(url),
});
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `baseUrl` | `string` | **(required)** | Dashboard API URL |
| `headers` | `Record<string, string>` | `{}` | Extra headers for every request |
| `fetch` | `typeof fetch` | `globalThis.fetch` | Custom fetch implementation |
| `eventSourceFactory` | `(url: string) => EventSource` | native `EventSource` | Custom factory for SSE connections |

## API Methods

### Queues

| Method | Returns | Description |
| --- | --- | --- |
| `listQueues()` | `ClientQueueInfo[]` | List all queues with state counts |
| `getQueue(name)` | `ClientQueueDetail` | Queue detail with paused job names |
| `pauseQueue(name, jobName?)` | `void` | Pause a queue or specific job name |
| `resumeQueue(name, jobName?)` | `void` | Resume a queue or specific job name |
| `drainQueue(name)` | `void` | Remove all waiting jobs |
| `cleanQueue(name, state, grace)` | `{ removed }` | Clean jobs older than grace ms |
| `retryAllJobs(name, state)` | `{ retried }` | Retry all jobs in a state |
| `promoteAllJobs(name)` | `{ promoted }` | Promote all delayed jobs |
| `obliterateQueue(name, force?)` | `void` | Delete queue and all jobs |
| `getQueueGroups(name)` | `ClientGroupInfo[]` | List groups with per-group counts |

### Jobs

| Method | Returns | Description |
| --- | --- | --- |
| `listJobs(queue, state, start?, end?)` | `PaginatedResponse<ClientJobData>` | Paginated job list |
| `getJob(queue, jobId)` | `ClientJobData` | Single job detail |
| `getJobChildren(queue, jobId)` | `ClientJobData[]` | Flow children |
| `addJob(queue, name, data, opts?)` | `ClientJobData` | Create a job |
| `retryJob(queue, jobId)` | `void` | Retry a failed job |
| `promoteJob(queue, jobId)` | `void` | Promote a delayed job |
| `cancelJob(queue, jobId)` | `void` | Cancel an active job |
| `removeJob(queue, jobId)` | `void` | Delete a job |
| `editJob(queue, jobId, updates)` | `ClientJobData` | Edit job data/priority |

### Search

| Method | Returns | Description |
| --- | --- | --- |
| `searchJob(jobId)` | `ClientJobData \| null` | Cross-queue job lookup by ID |
| `searchByPayload(queue, query)` | `ClientJobData[]` | Search jobs by payload content |
| `searchQueues(query)` | `ClientQueueInfo[]` | Search queues by name |

### Flows

| Method | Returns | Description |
| --- | --- | --- |
| `listFlowParents(state?)` | `ClientJobData[]` | List flow parent jobs |

### Metrics

| Method | Returns | Description |
| --- | --- | --- |
| `getMetrics(queue, granularity?, from?, to?)` | `ClientMetricsBucket[]` | Query metrics buckets |
| `getSparklines()` | `Record<string, number[]>` | Sparkline data for all queues |
| `getMetricsStatus()` | `boolean` | Check if metrics are enabled |

## Real-Time Events (SSE)

Subscribe to server-sent events for live updates:

```typescript
const sub = client.subscribe({
  // Optional: omit for all queues
  queueName: 'emails',

  // Called for each event
  onEvent: (event) => {
    console.log(event.type, event.queueName, event.jobId);
  },

  // Optional: called on connection error
  onError: (e) => console.error('SSE error', e),

  // Optional: filter specific event types
  eventTypes: ['job:completed', 'job:failed'],

  // Optional: reconnect delay in ms (default: 3000)
  reconnectDelay: 5000,
});

// Later: disconnect
sub.close();
```

### Event Types

The following SSE event types are emitted by the dashboard API:

| Event | Description |
| --- | --- |
| `job:waiting` | Job added to queue |
| `job:active` | Job picked up by a worker |
| `job:completed` | Job finished successfully |
| `job:failed` | Job failed |
| `job:progress` | Job reported progress |
| `job:delayed` | Job scheduled for later |
| `job:removed` | Job removed |
| `job:cancelled` | Active job cancelled |
| `job:stalled` | Job detected as stalled |
| `queue:paused` | Queue paused |
| `queue:resumed` | Queue resumed |
| `queue:drained` | All waiting jobs consumed |

## Error Handling

API errors throw a `ConveyorApiError` with the HTTP status and error code:

```typescript
import { ConveyorApiError } from '@conveyor/dashboard-client';

try {
  await client.getJob('emails', 'nonexistent');
} catch (err) {
  if (err instanceof ConveyorApiError) {
    console.log(err.status);  // 404
    console.log(err.code);    // 'NOT_FOUND'
    console.log(err.message); // 'Job nonexistent not found'
  }
}
```

## SSE Authentication

Native `EventSource` does not support custom headers. For token-based auth in non-browser runtimes,
provide a custom `eventSourceFactory`:

```typescript
import EventSource from 'eventsource'; // npm polyfill

const client = new ConveyorDashboardClient({
  baseUrl: 'http://localhost:3000',
  headers: { Authorization: 'Bearer my-token' },
  eventSourceFactory: (url) =>
    new EventSource(url, {
      headers: { Authorization: 'Bearer my-token' },
    }),
});
```

For browser environments with cookie-based auth, native `EventSource` works without any extra
configuration.

## Types

All response types use JSON wire format (dates as ISO 8601 strings):

```typescript
import type {
  ClientJobData,       // Job with string dates
  ClientQueueInfo,     // Queue summary
  ClientQueueDetail,   // Queue detail with paused names
  ClientGroupInfo,     // Group active/waiting counts
  ClientMetricsBucket, // Metrics bucket
  SSEEvent,            // SSE event payload
  PaginatedResponse,   // { data: T[], meta: { total, start, end } }
  JobState,            // 'waiting' | 'active' | 'completed' | ...
  StoreEventType,      // 'job:waiting' | 'job:completed' | ...
  AttemptRecord,       // Per-attempt logs and stacktrace
} from '@conveyor/dashboard-client';
```
