# Examples

These annotated examples show how to use Conveyor with different store backends. Each example is a
complete, runnable script.

## Available Examples

| Example                      | Store         | Key Features                                             |
| ---------------------------- | ------------- | -------------------------------------------------------- |
| [Basic (In-Memory)](./basic) | `MemoryStore` | Queue, Worker, events, scheduling, deduplication         |
| [PostgreSQL](./postgresql)   | `PgStore`     | Cron scheduling, cross-process events, graceful shutdown |
| [SQLite](./sqlite)           | `SqliteStore` | Rate limiting, recurring jobs, file-based persistence    |

## Choosing a Store

| Store         | Best For                                       | Trade-offs                                                   |
| ------------- | ---------------------------------------------- | ------------------------------------------------------------ |
| `MemoryStore` | Testing, prototyping, single-process apps      | Data lost on restart, no cross-process support               |
| `PgStore`     | Production, multi-process, distributed systems | Requires PostgreSQL server                                   |
| `SqliteStore` | Single-server production, embedded apps        | File-based, no real-time cross-process events (uses polling) |

## Running the Examples

All examples are in the `examples/` directory of the repository.

```bash
# Basic (in-memory)
deno run --allow-all examples/basic/main.ts

# PostgreSQL (requires PG_URL)
export PG_URL="postgres://user:pass@localhost:5432/mydb"
deno run --allow-all examples/with-pg/main.ts

# SQLite
deno run --allow-all examples/with-sqlite/main.ts
```

## Common Pattern

Every Conveyor application follows the same structure regardless of the store backend:

1. **Create a store** and call `connect()`
2. **Create a Queue** with the store
3. **Create a Worker** with a processor function
4. **Add jobs** to the queue
5. **Listen to events** for monitoring
6. **Clean up** with `close()` and `disconnect()`

```typescript
// 1. Store
const store = new MemoryStore();
await store.connect();

// 2. Queue
const queue = new Queue('my-queue', { store });

// 3. Worker
const worker = new Worker('my-queue', async (job) => {
  // process job
  return result;
}, { store });

// 4. Add jobs
await queue.add('task-name', { key: 'value' });

// 5. Events
worker.on('completed', (data) => {/* ... */});

// 6. Cleanup
await worker.close();
await queue.close();
await store.disconnect();
```
