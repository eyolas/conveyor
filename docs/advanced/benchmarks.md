# Benchmarks

Conveyor includes a benchmark suite to measure throughput of core operations. All benchmarks run on
`MemoryStore` with Deno to isolate queue logic from I/O overhead.

Run benchmarks:

```bash
deno task bench
```

## Summary

| Benchmark                        | Result                     | Notes                    |
| -------------------------------- | -------------------------- | ------------------------ |
| Queue.add (500 jobs)             | 2.68ms total, ~373 ops/sec | Sequential adds          |
| fetchNextJob (from 1,000)        | 188us per fetch            | Atomic lock + fetch      |
| Batch worker (20 jobs, batch=20) | ~1s                        | 20x throughput vs single |
| Batch worker (20 jobs, batch=1)  | ~20s                       | Baseline comparison      |

## Key Findings

### Queue.add Throughput

Adding 500 jobs sequentially completes in approximately 2.68ms on the MemoryStore. This measures the
overhead of job data creation, deduplication checks, and store persistence.

### fetchNextJob Latency

Fetching the next job from a queue of 1,000 waiting jobs takes approximately 188 microseconds. This
includes the atomic select-and-lock operation. In PostgreSQL, this translates to a single
`SELECT ... FOR UPDATE SKIP LOCKED` query.

### Batch Processing

Batch processing provides significant throughput improvements when jobs can be processed together:

- **Batch size 20**: Processing 20 jobs takes approximately 1 second (all jobs processed in a single
  batch call).
- **Batch size 1**: The same 20 jobs take approximately 20 seconds when processed one at a time.
- **Improvement**: ~95% faster with batching enabled (20x throughput).

This makes batching ideal for operations that benefit from bulk I/O, such as database inserts, API
calls with batch endpoints, or bulk email sending.

## Store-Specific Performance

The benchmarks above use `MemoryStore` to measure pure queue overhead. Real-world performance
depends on the store backend:

| Store       | add()         | fetchNextJob() | Notes                                                               |
| ----------- | ------------- | -------------- | ------------------------------------------------------------------- |
| MemoryStore | Fastest       | Fastest        | No I/O, ideal for benchmarks and tests                              |
| PgStore     | Network-bound | Network-bound  | Performance depends on network latency and PostgreSQL configuration |
| SqliteStore | Disk-bound    | Disk-bound     | WAL mode helps; performance depends on disk speed                   |

### PostgreSQL Optimization Tips

- Use connection pooling for high-throughput producers.
- Place the database close to your workers (same datacenter/region).
- Tune `work_mem` and `shared_buffers` for your workload.
- Use `addBulk()` instead of individual `add()` calls for batch inserts.

### SQLite Optimization Tips

- Use an SSD for the database file.
- WAL mode is enabled automatically -- do not disable it.
- For write-heavy workloads, consider PostgreSQL instead.
- Keep the database file on a local filesystem (not NFS or network mounts).

## Running Your Own Benchmarks

The benchmark suite is in the `benchmarks/` directory. You can add custom benchmarks:

```typescript
import { Queue, Worker } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';

const store = new MemoryStore();
await store.connect();

const queue = new Queue('bench', { store });

const start = performance.now();
for (let i = 0; i < 1000; i++) {
  await queue.add('task', { index: i });
}
const elapsed = performance.now() - start;

console.log(`1000 adds in ${elapsed.toFixed(2)}ms`);

await queue.close();
await store.disconnect();
```
