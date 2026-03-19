# Graceful Shutdown

Conveyor supports graceful shutdown for workers, queues, and store connections. When closing a
worker, active jobs are given time to finish before the worker stops. The library also supports
`Symbol.asyncDispose` for use with `await using` declarations.

## Quick Examples

### Worker Close with Default Timeout

```typescript
import { Worker } from '@conveyor/core';

const worker = new Worker('tasks', handler, { store });

// Wait up to 30 seconds (default) for active jobs to finish
await worker.close();
```

### Worker Close with Custom Timeout

```typescript
// Wait up to 60 seconds
await worker.close(60_000);

// Wait up to 5 seconds (aggressive shutdown)
await worker.close(5_000);
```

### Queue and Store Cleanup

```typescript
import { Queue } from '@conveyor/core';

const queue = new Queue('tasks', { store });

// Close the queue (removes event listeners)
await queue.close();

// Disconnect the store (releases database connections)
await store.disconnect();
```

### Full Shutdown Sequence

```typescript
// Recommended order: worker -> queue -> store
await worker.close();
await queue.close();
await store.disconnect();
```

### Using `Symbol.asyncDispose`

```typescript
{
  await using worker = new Worker('tasks', handler, { store });
  await using queue = new Queue('tasks', { store });

  // ... use worker and queue ...

  // Automatically closed when leaving the block
}
```

### Process Signal Handling

```typescript
const worker = new Worker('tasks', handler, { store });

async function shutdown() {
  console.log('Shutting down...');
  await worker.close(30_000);
  await store.disconnect();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

## API Reference

### `worker.close(forceTimeout?)`

Gracefully close the worker.

| Parameter      | Type     | Default  | Description                                      |
| -------------- | -------- | -------- | ------------------------------------------------ |
| `forceTimeout` | `number` | `30_000` | Max time in ms to wait for active jobs to finish |

The close sequence:

1. Sets the `closed` flag -- no new jobs will be fetched.
2. Stops the poll timer.
3. Stops the stalled job check timer.
4. Waits for active jobs to finish, or until `forceTimeout` expires (whichever comes first).
5. Clears all lock renewal timers.
6. Clears all abort controllers.
7. Removes all event listeners.

### `queue.close()`

Close the queue and remove all event listeners. This is a lightweight operation with no async work
beyond clearing internal state.

### `store.disconnect()`

Close the store's database connection and release resources. After disconnecting:

- PostgreSQL: closes the connection pool and LISTEN channels.
- SQLite: closes the database file.
- Memory: clears all data structures.

### `Symbol.asyncDispose`

Both `Worker` and `Queue` implement `Symbol.asyncDispose`, enabling `await using`:

```typescript
await using worker = new Worker('tasks', handler, { store });
// worker.close() is called automatically when the block exits
```

## How It Works Internally

### Worker Close Sequence

```
close(forceTimeout) called
  |
  v
closed = true  (stops new fetches)
  |
  v
clearTimeout(pollTimer)      (stops polling)
clearTimeout(stalledTimer)   (stops stalled checks)
  |
  v
activeCount > 0?
  |-- yes --> Promise.race([waitForActive(), timeout(forceTimeout)])
  |-- no  --> continue
  |
  v
Clear lock renewal timers
Clear abort controllers
Remove event listeners
```

### What Happens to Active Jobs

When `close()` is called:

- **Active jobs continue running.** The worker waits for them to complete naturally.
- **If `forceTimeout` expires**: the close promise resolves even if jobs are still running. Lock
  renewal timers are cleared, so the jobs' locks will eventually expire and be detected as stalled
  by other workers.
- **No abort signals are sent.** Jobs are not forcefully cancelled during close. They finish
  normally or stall.

### Lock Expiration After Force Timeout

If a worker is forced to close while jobs are still active:

1. Lock renewal timers are cleared.
2. The job's lock expires after `lockDuration` (default: 30 seconds).
3. Another worker's stalled job detection picks it up and re-enqueues it (if retries remain) or
   marks it as failed.

## Configuration Options

### WorkerOptions (relevant to shutdown)

| Option            | Type      | Default  | Description                                                      |
| ----------------- | --------- | -------- | ---------------------------------------------------------------- |
| `lockDuration`    | `number`  | `30_000` | Lock duration in ms; affects stalled detection after force close |
| `stalledInterval` | `number`  | `30_000` | How often to check for stalled jobs                              |
| `autoStart`       | `boolean` | `true`   | If `false`, worker does not start until `start()` is called      |

## Shutdown Patterns

### Kubernetes / Container Shutdown

```typescript
const SHUTDOWN_TIMEOUT = 25_000; // Leave 5s buffer before SIGKILL

async function shutdown() {
  await Promise.all([
    worker1.close(SHUTDOWN_TIMEOUT),
    worker2.close(SHUTDOWN_TIMEOUT),
  ]);
  await store.disconnect();
}

process.on('SIGTERM', shutdown);
```

### Health Check During Shutdown

```typescript
let shuttingDown = false;

app.get('/health', (req, res) => {
  if (shuttingDown) {
    res.status(503).json({ status: 'shutting-down' });
  } else {
    res.status(200).json({ status: 'ok' });
  }
});

async function shutdown() {
  shuttingDown = true;
  await worker.close(30_000);
  await store.disconnect();
}
```

### Worker Restart

```typescript
// Pause -> close -> recreate
worker.pause();

// Wait for current poll cycle to finish
await new Promise((r) => setTimeout(r, 2_000));

await worker.close();

// Create a fresh worker
const newWorker = new Worker('tasks', newHandler, { store });
```

## Caveats

- **Force timeout does not cancel jobs.** After the timeout, the close promise resolves, but active
  jobs may still be running in the background until their lock expires.
- **Lock renewal stops immediately on close.** If jobs take longer than `lockDuration` after close,
  they will be detected as stalled by other workers.
- **Close is idempotent.** Calling `close()` multiple times is safe -- subsequent calls resolve
  immediately.
- **Store disconnect is permanent.** After calling `store.disconnect()`, the store cannot be reused.
  Create a new store instance if needed.
- **Order matters.** Always close workers before disconnecting the store. A worker that tries to
  update a job after store disconnection will throw.
- **`await using` calls close with default timeout.** If you need a custom timeout, call
  `close(timeout)` explicitly instead of relying on `Symbol.asyncDispose`.

## See Also

- [Pause and Resume](/features/pause-resume) -- pause without closing
- [Events](/features/events) -- the `error` event during shutdown
- [Concurrency](/features/concurrency) -- how active count affects shutdown timing
