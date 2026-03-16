# Conveyor Benchmark Results

> Generated on **2026-03-16** | Deno/2.7.2 aarch64-apple-darwin | CPU: Apple M3 Pro

## Table of Contents

- [Batch](#batch)
- [Features](#features)
- [Flow](#flow)
- [Queue Throughput](#queue-throughput)
- [Store Operations](#store-operations)
- [Worker Processing](#worker-processing)

## Summary

| Benchmark                               | Avg       | p75       | p99       | Ops/sec | Iterations |
| --------------------------------------- | --------- | --------- | --------- | ------- | ---------- |
| Batch worker × 20 (batch=1)             | 20.05 s   | 20.06 s   | 20.06 s   | 0.05    | 3          |
| Batch worker × 20 (batch=10)            | 2.01 s    | 2.01 s    | 2.01 s    | 0.50    | 3          |
| Batch worker × 20 (batch=20)            | 1.00 s    | 1.00 s    | 1.00 s    | 1.00    | 3          |
| add × 500 (no dedup)                    | 2.71 ms   | 2.76 ms   | 4.14 ms   | 368.57  | 194        |
| add × 500 (hash dedup)                  | 14.01 ms  | 14.06 ms  | 20.14 ms  | 71.39   | 46         |
| add × 500 (custom key dedup)            | 4.45 ms   | 4.54 ms   | 5.66 ms   | 224.55  | 122        |
| add × 500 (no priority)                 | 2.66 ms   | 2.68 ms   | 2.97 ms   | 376.04  | 198        |
| add × 500 (with priority)               | 2.81 ms   | 2.86 ms   | 3.14 ms   | 355.59  | 188        |
| fetch × 500 (FIFO)                      | 8.24 ms   | 8.92 ms   | 9.33 ms   | 121.33  | 61         |
| fetch × 500 (LIFO)                      | 8.05 ms   | 8.15 ms   | 8.49 ms   | 124.19  | 64         |
| promoteDelayedJobs (500 delayed)        | 32.16 µs  | 31.58 µs  | 66.42 µs  | 31.09K  | 335        |
| removeJob × 500                         | 83.29 µs  | 85.58 µs  | 161.42 µs | 12.01K  | 199        |
| store.saveFlow (1 parent + 5 children)  | 16.66 µs  | 16.50 µs  | 22.00 µs  | 60.01K  | 27581      |
| store.saveFlow (1 parent + 20 children) | 57.91 µs  | 56.42 µs  | 108.29 µs | 17.27K  | 8182       |
| store.saveFlow (1 parent + 50 children) | 138.51 µs | 137.50 µs | 195.75 µs | 7.22K   | 3464       |
| store.notifyChildCompleted × 20         | 47.09 µs  | 46.50 µs  | 61.33 µs  | 21.24K  | 4614       |
| store.getChildrenJobs (50 children)     | 113.31 µs | 113.88 µs | 180.21 µs | 8.83K   | 1924       |
| Queue.add × 100                         | 538.19 µs | 537.29 µs | 774.08 µs | 1.86K   | 936        |
| Queue.add × 500                         | 2.64 ms   | 2.67 ms   | 2.80 ms   | 378.63  | 200        |
| Queue.add × 1000                        | 5.52 ms   | 5.51 ms   | 6.46 ms   | 181.28  | 101        |
| Queue.addBulk × 100                     | 520.26 µs | 525.75 µs | 638.25 µs | 1.92K   | 965        |
| Queue.addBulk × 500                     | 2.70 ms   | 2.73 ms   | 3.30 ms   | 369.92  | 194        |
| Queue.addBulk × 1000                    | 5.40 ms   | 5.29 ms   | 5.64 ms   | 185.24  | 102        |
| Queue.addBulk × 5000                    | 27.88 ms  | 27.94 ms  | 29.10 ms  | 35.87   | 28         |
| add × 500 (sequential)                  | 2.78 ms   | 2.73 ms   | 3.48 ms   | 359.48  | 190        |
| addBulk × 500 (batch)                   | 2.62 ms   | 2.64 ms   | 2.92 ms   | 381.14  | 200        |
| store.saveJob × 1                       | 2.99 µs   | 3.04 µs   | 3.23 µs   | 333.96K | 27         |
| store.saveBulk × 100                    | 275.72 µs | 275.83 µs | 355.88 µs | 3.63K   | 1762       |
| store.saveBulk × 1000                   | 2.75 ms   | 2.83 ms   | 3.25 ms   | 363.45  | 187        |
| store.fetchNextJob (from 1000 waiting)  | 158.92 µs | 167.42 µs | 305.67 µs | 6.29K   | 178        |
| fetch+complete cycle × 100              | 746.11 µs | 768.88 µs | 891.13 µs | 1.34K   | 498        |
| fetch+complete cycle × 500              | 8.83 ms   | 8.94 ms   | 9.16 ms   | 113.28  | 59         |
| store.countJobs (1000 jobs)             | 16.39 µs  | 21.13 µs  | 61.58 µs  | 60.99K  | 189        |
| store.listJobs (page 0..50 of 1000)     | 155.43 µs | 167.42 µs | 217.58 µs | 6.43K   | 180        |
| store.clean 1000 completed jobs         | 73.50 µs  | 79.29 µs  | 173.33 µs | 13.60K  | 178        |
| store.drain 1000 waiting jobs           | 59.06 µs  | 68.46 µs  | 143.58 µs | 16.93K  | 175        |
| Worker × 20 jobs (concurrency=1)        | 20.06 s   | 20.07 s   | 20.07 s   | 0.05    | 3          |
| Worker × 20 jobs (concurrency=10)       | 1.00 s    | 1.01 s    | 1.01 s    | 1.00    | 3          |
| Worker × 20 jobs (concurrency=20)       | 1.00 s    | 1.01 s    | 1.01 s    | 1.00    | 3          |

## Batch

### Batch Size

| Benchmark                                | Avg                   | Min     | Max     | p75     | p99     | Ops/sec | Iterations |
| ---------------------------------------- | --------------------- | ------- | ------- | ------- | ------- | ------- | ---------- |
| Batch worker × 20 (batch=1) _(baseline)_ | 20.05 s               | 20.05 s | 20.06 s | 20.06 s | 20.06 s | 0.05    | 3          |
| Batch worker × 20 (batch=10)             | 2.01 s **90% faster** | 2.00 s  | 2.01 s  | 2.01 s  | 2.01 s  | 0.50    | 3          |
| Batch worker × 20 (batch=20)             | 1.00 s **95% faster** | 1.00 s  | 1.00 s  | 1.00 s  | 1.00 s  | 1.00    | 3          |

## Features

### Deduplication

| Benchmark                         | Avg                    | Min      | Max      | p75      | p99      | Ops/sec | Iterations |
| --------------------------------- | ---------------------- | -------- | -------- | -------- | -------- | ------- | ---------- |
| add × 500 (no dedup) _(baseline)_ | 2.71 ms                | 2.46 ms  | 5.78 ms  | 2.76 ms  | 4.14 ms  | 368.57  | 194        |
| add × 500 (hash dedup)            | 14.01 ms _416% slower_ | 13.21 ms | 20.14 ms | 14.06 ms | 20.14 ms | 71.39   | 46         |
| add × 500 (custom key dedup)      | 4.45 ms _64% slower_   | 4.20 ms  | 5.75 ms  | 4.54 ms  | 5.66 ms  | 224.55  | 122        |

### Priority

| Benchmark                            | Avg                 | Min     | Max     | p75     | p99     | Ops/sec | Iterations |
| ------------------------------------ | ------------------- | ------- | ------- | ------- | ------- | ------- | ---------- |
| add × 500 (no priority) _(baseline)_ | 2.66 ms             | 2.47 ms | 5.41 ms | 2.68 ms | 2.97 ms | 376.04  | 198        |
| add × 500 (with priority)            | 2.81 ms _6% slower_ | 2.58 ms | 3.32 ms | 2.86 ms | 3.14 ms | 355.59  | 188        |

### Fifo Vs Lifo

| Benchmark                       | Avg                   | Min     | Max     | p75     | p99     | Ops/sec | Iterations |
| ------------------------------- | --------------------- | ------- | ------- | ------- | ------- | ------- | ---------- |
| fetch × 500 (FIFO) _(baseline)_ | 8.24 ms               | 6.95 ms | 9.33 ms | 8.92 ms | 9.33 ms | 121.33  | 61         |
| fetch × 500 (LIFO)              | 8.05 ms **2% faster** | 7.50 ms | 8.49 ms | 8.15 ms | 8.49 ms | 124.19  | 64         |

### Delayed

| Benchmark                        | Avg      | Min      | Max       | p75      | p99      | Ops/sec | Iterations |
| -------------------------------- | -------- | -------- | --------- | -------- | -------- | ------- | ---------- |
| promoteDelayedJobs (500 delayed) | 32.16 µs | 23.29 µs | 250.42 µs | 31.58 µs | 66.42 µs | 31.09K  | 335        |

### Job Removal

| Benchmark       | Avg      | Min      | Max       | p75      | p99       | Ops/sec | Iterations |
| --------------- | -------- | -------- | --------- | -------- | --------- | ------- | ---------- |
| removeJob × 500 | 83.29 µs | 70.08 µs | 292.92 µs | 85.58 µs | 161.42 µs | 12.01K  | 199        |

## Flow

### Flow Creation

| Benchmark                               | Avg       | Min       | Max     | p75       | p99       | Ops/sec | Iterations |
| --------------------------------------- | --------- | --------- | ------- | --------- | --------- | ------- | ---------- |
| store.saveFlow (1 parent + 5 children)  | 16.66 µs  | 14.21 µs  | 2.65 ms | 16.50 µs  | 22.00 µs  | 60.01K  | 27581      |
| store.saveFlow (1 parent + 20 children) | 57.91 µs  | 52.38 µs  | 2.81 ms | 56.42 µs  | 108.29 µs | 17.27K  | 8182       |
| store.saveFlow (1 parent + 50 children) | 138.51 µs | 128.42 µs | 6.00 ms | 137.50 µs | 195.75 µs | 7.22K   | 3464       |

### Flow Notify

| Benchmark                       | Avg      | Min      | Max       | p75      | p99      | Ops/sec | Iterations |
| ------------------------------- | -------- | -------- | --------- | -------- | -------- | ------- | ---------- |
| store.notifyChildCompleted × 20 | 47.09 µs | 42.54 µs | 146.71 µs | 46.50 µs | 61.33 µs | 21.24K  | 4614       |

### Flow Query

| Benchmark                           | Avg       | Min       | Max       | p75       | p99       | Ops/sec | Iterations |
| ----------------------------------- | --------- | --------- | --------- | --------- | --------- | ------- | ---------- |
| store.getChildrenJobs (50 children) | 113.31 µs | 101.42 µs | 255.67 µs | 113.88 µs | 180.21 µs | 8.83K   | 1924       |

## Queue Throughput

### Queue Add

| Benchmark        | Avg       | Min       | Max     | p75       | p99       | Ops/sec | Iterations |
| ---------------- | --------- | --------- | ------- | --------- | --------- | ------- | ---------- |
| Queue.add × 100  | 538.19 µs | 495.88 µs | 3.10 ms | 537.29 µs | 774.08 µs | 1.86K   | 936        |
| Queue.add × 500  | 2.64 ms   | 2.50 ms   | 3.99 ms | 2.67 ms   | 2.80 ms   | 378.63  | 200        |
| Queue.add × 1000 | 5.52 ms   | 5.10 ms   | 8.62 ms | 5.51 ms   | 6.46 ms   | 181.28  | 101        |

### Queue AddBulk

| Benchmark            | Avg       | Min       | Max       | p75       | p99       | Ops/sec | Iterations |
| -------------------- | --------- | --------- | --------- | --------- | --------- | ------- | ---------- |
| Queue.addBulk × 100  | 520.26 µs | 480.46 µs | 715.17 µs | 525.75 µs | 638.25 µs | 1.92K   | 965        |
| Queue.addBulk × 500  | 2.70 ms   | 2.45 ms   | 8.02 ms   | 2.73 ms   | 3.30 ms   | 369.92  | 194        |
| Queue.addBulk × 1000 | 5.40 ms   | 5.06 ms   | 21.80 ms  | 5.29 ms   | 5.64 ms   | 185.24  | 102        |
| Queue.addBulk × 5000 | 27.88 ms  | 27.29 ms  | 29.10 ms  | 27.94 ms  | 29.10 ms  | 35.87   | 28         |

### Add Vs AddBulk

| Benchmark                          | Avg                 | Min     | Max      | p75     | p99     | Ops/sec | Iterations |
| ---------------------------------- | ------------------- | ------- | -------- | ------- | ------- | ------- | ---------- |
| add × 500 (sequential)             | 2.78 ms _6% slower_ | 2.55 ms | 17.31 ms | 2.73 ms | 3.48 ms | 359.48  | 190        |
| addBulk × 500 (batch) _(baseline)_ | 2.62 ms             | 2.49 ms | 2.97 ms  | 2.64 ms | 2.92 ms | 381.14  | 200        |

## Store Operations

### Store Save

| Benchmark             | Avg       | Min       | Max     | p75       | p99       | Ops/sec | Iterations |
| --------------------- | --------- | --------- | ------- | --------- | --------- | ------- | ---------- |
| store.saveJob × 1     | 2.99 µs   | 2.89 µs   | 3.23 µs | 3.04 µs   | 3.23 µs   | 333.96K | 27         |
| store.saveBulk × 100  | 275.72 µs | 249.54 µs | 6.13 ms | 275.83 µs | 355.88 µs | 3.63K   | 1762       |
| store.saveBulk × 1000 | 2.75 ms   | 2.55 ms   | 3.42 ms | 2.83 ms   | 3.25 ms   | 363.45  | 187        |

### Store Fetch

| Benchmark                              | Avg       | Min       | Max       | p75       | p99       | Ops/sec | Iterations |
| -------------------------------------- | --------- | --------- | --------- | --------- | --------- | ------- | ---------- |
| store.fetchNextJob (from 1000 waiting) | 158.92 µs | 121.42 µs | 320.00 µs | 167.42 µs | 305.67 µs | 6.29K   | 178        |

### Store Process Cycle

| Benchmark                  | Avg       | Min       | Max       | p75       | p99       | Ops/sec | Iterations |
| -------------------------- | --------- | --------- | --------- | --------- | --------- | ------- | ---------- |
| fetch+complete cycle × 100 | 746.11 µs | 697.50 µs | 980.04 µs | 768.88 µs | 891.13 µs | 1.34K   | 498        |
| fetch+complete cycle × 500 | 8.83 ms   | 8.18 ms   | 9.16 ms   | 8.94 ms   | 9.16 ms   | 113.28  | 59         |

### Store Query

| Benchmark                           | Avg       | Min       | Max       | p75       | p99       | Ops/sec | Iterations |
| ----------------------------------- | --------- | --------- | --------- | --------- | --------- | ------- | ---------- |
| store.countJobs (1000 jobs)         | 16.39 µs  | 5.75 µs   | 66.67 µs  | 21.13 µs  | 61.58 µs  | 60.99K  | 189        |
| store.listJobs (page 0..50 of 1000) | 155.43 µs | 131.21 µs | 219.92 µs | 167.42 µs | 217.58 µs | 6.43K   | 180        |

### Store Maintenance

| Benchmark                       | Avg      | Min      | Max       | p75      | p99       | Ops/sec | Iterations |
| ------------------------------- | -------- | -------- | --------- | -------- | --------- | ------- | ---------- |
| store.clean 1000 completed jobs | 73.50 µs | 47.25 µs | 391.38 µs | 79.29 µs | 173.33 µs | 13.60K  | 178        |
| store.drain 1000 waiting jobs   | 59.06 µs | 40.21 µs | 146.50 µs | 68.46 µs | 143.58 µs | 16.93K  | 175        |

## Worker Processing

### Worker Concurrency

| Benchmark                                     | Avg                   | Min     | Max     | p75     | p99     | Ops/sec | Iterations |
| --------------------------------------------- | --------------------- | ------- | ------- | ------- | ------- | ------- | ---------- |
| Worker × 20 jobs (concurrency=1) _(baseline)_ | 20.06 s               | 20.05 s | 20.07 s | 20.07 s | 20.07 s | 0.05    | 3          |
| Worker × 20 jobs (concurrency=10)             | 1.00 s **95% faster** | 1.00 s  | 1.01 s  | 1.01 s  | 1.01 s  | 1.00    | 3          |
| Worker × 20 jobs (concurrency=20)             | 1.00 s **95% faster** | 1.00 s  | 1.01 s  | 1.01 s  | 1.01 s  | 1.00    | 3          |

## Key Takeaways

- **`addBulk`** is significantly faster than sequential `add()` for large batches
- **Higher concurrency** reduces total processing time — with a 1s poll interval, concurrency=N
  processes N jobs per cycle
- **Batch workers** outperform sequential processing for trivial jobs
- **Hash deduplication** adds notable overhead (~5x) due to SHA-256 hashing; custom key dedup is
  cheaper (~1.7x)
- **FIFO vs LIFO** have nearly identical fetch performance
- **Priority** adds negligible overhead
- **Flow creation** scales linearly with child count (~3µs per child)
- All benchmarks run against **MemoryStore** (in-memory) for deterministic baselines
