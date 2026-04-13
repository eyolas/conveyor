# API Reference

All endpoints are prefixed with `{basePath}/api`. The default base path is `/`, so endpoints are at `/api/...`.

## Queues

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/queues` | List all queues (filtered by `queues` option if set) |
| `GET` | `/api/queues/:name` | Queue detail: job counts and paused job names |
| `POST` | `/api/queues/:name/pause` | Pause a queue or a specific job name |
| `POST` | `/api/queues/:name/resume` | Resume a queue or a specific job name |
| `POST` | `/api/queues/:name/drain` | Drain all waiting and delayed jobs |
| `POST` | `/api/queues/:name/clean` | Remove jobs in a given state older than a grace period |
| `POST` | `/api/queues/:name/retry` | Retry all failed or completed jobs |
| `POST` | `/api/queues/:name/promote` | Promote all delayed jobs to waiting |
| `DELETE` | `/api/queues/:name` | Obliterate a queue (use `?force=true` to force) |

### Pause / Resume Body

```json
{ "jobName": "send-email" }
```

Omit `jobName` (or set to `"__all__"`) to pause/resume the entire queue.

### Clean Body

```json
{ "state": "completed", "grace": 3600000 }
```

`grace` is in milliseconds. Removes jobs in the given state older than the grace period.

### Retry Body

```json
{ "state": "failed" }
```

`state` must be `"failed"` or `"completed"`.

## Jobs

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/queues/:name/jobs` | List jobs with pagination |
| `POST` | `/api/queues/:name/jobs` | Add a new job |
| `GET` | `/api/queues/:name/jobs/:id` | Job detail |
| `GET` | `/api/queues/:name/jobs/:id/children` | List child jobs (flow) |
| `POST` | `/api/queues/:name/jobs/:id/retry` | Retry a single failed/completed job |
| `POST` | `/api/queues/:name/jobs/:id/promote` | Promote a single delayed job to waiting |
| `POST` | `/api/queues/:name/jobs/:id/cancel` | Cancel an active job |
| `PATCH` | `/api/queues/:name/jobs/:id` | Edit job payload or priority |
| `DELETE` | `/api/queues/:name/jobs/:id` | Remove a job |

### List Jobs Query Parameters

| Parameter | Default | Description |
| --- | --- | --- |
| `state` | `waiting` | Job state to filter by |
| `start` | `0` | Pagination offset |
| `end` | `100` | Pagination end index (max page size: 1000) |

### Add Job Body

```json
{
  "name": "send-email",
  "data": { "to": "user@example.com" },
  "opts": { "priority": 1, "delay": 5000 }
}
```

### Edit Job Body

```json
{
  "data": { "to": "updated@example.com" },
  "opts": { "priority": 2 }
}
```

Cannot edit active jobs.

## Groups

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/queues/:name/groups` | List distinct groups with active/waiting counts |

## Flows

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/flows` | List flow parent jobs |

### Query Parameters

| Parameter | Default | Description |
| --- | --- | --- |
| `state` | all | Filter by job state |

## Search

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/search` | Search for jobs, queues, or payloads |

### Query Parameters

| Parameter | Required | Description |
| --- | --- | --- |
| `q` | yes | Search term (job ID, queue name substring, or payload text) |
| `type` | no | `"job"` (default), `"queue"`, or `"payload"` |
| `queue` | for payload search | Queue name to search within |

## Metrics

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/queues/:name/metrics` | Per-queue metrics buckets |
| `GET` | `/api/metrics/sparklines` | Batch sparklines for all queues |
| `GET` | `/api/metrics/status` | Check if metrics are enabled |

### Metrics Query Parameters

| Parameter | Default | Description |
| --- | --- | --- |
| `granularity` | `minute` | `"minute"` or `"hour"` |
| `from` | 1 hour ago | ISO 8601 date string |
| `to` | now | ISO 8601 date string |

## SSE Events

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/events` | SSE stream for all queues |
| `GET` | `/api/queues/:name/events` | SSE stream for a single queue |

The SSE stream sends a `connected` event on connection, then real-time events as they occur.

### Event Types

| Event | Description |
| --- | --- |
| `connected` | Initial connection confirmation |
| `job:waiting` | Job moved to waiting state |
| `job:active` | Job picked up by a worker |
| `job:completed` | Job completed successfully |
| `job:failed` | Job failed |
| `job:delayed` | Job delayed |
| `job:removed` | Job removed |
| `job:progress` | Job progress updated |
| `job:stalled` | Job detected as stalled |
| `queue:paused` | Queue or job name paused |
| `queue:resumed` | Queue or job name resumed |
| `queue:drained` | Queue drained |

### SSE Client Example

```typescript
const events = new EventSource('/api/events');

events.addEventListener('job:completed', (e) => {
  const event = JSON.parse(e.data);
  console.log(`Job ${event.jobId} completed in queue ${event.queueName}`);
});

events.addEventListener('job:failed', (e) => {
  const event = JSON.parse(e.data);
  console.log(`Job ${event.jobId} failed: ${event.data?.reason}`);
});
```

## Response Format

### Success (single item)

```json
{
  "data": { ... }
}
```

### Success (paginated)

```json
{
  "data": [ ... ],
  "meta": {
    "total": 42,
    "start": 0,
    "end": 100
  }
}
```

### Error

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "state must be \"failed\" or \"completed\""
  }
}
```

Common error codes: `BAD_REQUEST`, `NOT_FOUND`, `FORBIDDEN` (read-only mode), `UNAUTHORIZED` (auth failed), `METRICS_DISABLED`.

## OpenAPI Specification

The complete OpenAPI 3.1 spec is available at [`/openapi.json`](/openapi.json).

You can import it into tools like [Swagger Editor](https://editor.swagger.io/) or [Scalar](https://scalar.com/) for an interactive API explorer.
