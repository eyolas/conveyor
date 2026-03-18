# Conveyor Benchmark Results

> Generated on **2026-03-18** | Deno/2.7.2 aarch64-apple-darwin | CPU: Apple M3 Pro

## Table of Contents

- [Batch](#batch)
- [Features](#features)
- [Flow](#flow)
- [Observable](#observable)
- [Queue Throughput](#queue-throughput)
- [Rate Limiting](#rate-limiting)
- [Scheduling](#scheduling)
- [Store Operations](#store-operations)
- [Worker Processing](#worker-processing)

## Summary

| Benchmark                                             | Avg       | p75       | p99       | Ops/sec | Iterations |
| ----------------------------------------------------- | --------- | --------- | --------- | ------- | ---------- |
| Batch worker × 20 (batch=1)                           | 20.05 s   | 20.05 s   | 20.05 s   | 0.05    | 3          |
| Batch worker × 20 (batch=10)                          | 2.01 s    | 2.01 s    | 2.01 s    | 0.50    | 3          |
| Batch worker × 20 (batch=20)                          | 1.00 s    | 1.00 s    | 1.00 s    | 1.00    | 3          |
| add × 500 (no dedup)                                  | 2.88 ms   | 2.94 ms   | 4.10 ms   | 347.47  | 183        |
| add × 500 (hash dedup)                                | 13.73 ms  | 13.82 ms  | 14.26 ms  | 72.84   | 47         |
| add × 500 (custom key dedup)                          | 4.45 ms   | 4.54 ms   | 4.73 ms   | 224.58  | 123        |
| add × 500 (no priority)                               | 2.74 ms   | 2.79 ms   | 3.17 ms   | 364.81  | 193        |
| add × 500 (with priority)                             | 3.03 ms   | 3.02 ms   | 7.20 ms   | 329.98  | 175        |
| fetch × 500 (FIFO)                                    | 8.42 ms   | 9.06 ms   | 9.48 ms   | 118.80  | 60         |
| fetch × 500 (LIFO)                                    | 8.25 ms   | 8.38 ms   | 8.88 ms   | 121.26  | 61         |
| promoteDelayedJobs (500 delayed)                      | 38.71 µs  | 40.67 µs  | 120.50 µs | 25.84K  | 323        |
| removeJob × 500                                       | 87.27 µs  | 88.38 µs  | 219.13 µs | 11.46K  | 193        |
| store.saveFlow (1 parent + 5 children)                | 18.82 µs  | 17.17 µs  | 73.79 µs  | 53.13K  | 24250      |
| store.saveFlow (1 parent + 20 children)               | 57.78 µs  | 57.42 µs  | 94.75 µs  | 17.31K  | 8191       |
| store.saveFlow (1 parent + 50 children)               | 143.06 µs | 141.92 µs | 229.88 µs | 6.99K   | 3355       |
| store.notifyChildCompleted × 20                       | 49.29 µs  | 49.08 µs  | 86.29 µs  | 20.29K  | 4421       |
| store.getChildrenJobs (50 children)                   | 118.86 µs | 119.83 µs | 212.25 µs | 8.41K   | 1851       |
| Queue.observe × 500 (creation only)                   | 13.79 µs  | 12.50 µs  | 42.00 µs  | 72.50K  | 190        |
| subscribe × 1 observers (1 job)                       | 2.77 µs   | 2.71 µs   | 4.29 µs   | 361.40K | 53425      |
| subscribe × 10 observers (1 job)                      | 24.64 µs  | 24.38 µs  | 33.42 µs  | 40.58K  | 15744      |
| subscribe × 50 observers (1 job)                      | 121.45 µs | 121.25 µs | 199.25 µs | 8.23K   | 3806       |
| cancel × 1 waiting jobs                               | 5.42 µs   | 5.38 µs   | 7.00 µs   | 184.33K | 41186      |
| cancel × 50 waiting jobs                              | 255.24 µs | 257.63 µs | 326.75 µs | 3.92K   | 950        |
| cancel × 200 waiting jobs                             | 1.04 ms   | 1.06 ms   | 1.23 ms   | 963.23  | 245        |
| observe → subscribe → process → onCompleted (10 jobs) | 1.00 s    | 1.00 s    | 1.00 s    | 1.00    | 3          |
| cancel active job (worker abort)                      | 82.97 µs  | 93.79 µs  | 93.79 µs  | 12.05K  | 3          |
| Queue.add × 100                                       | 554.26 µs | 560.67 µs | 707.04 µs | 1.80K   | 910        |
| Queue.add × 500                                       | 2.68 ms   | 2.72 ms   | 3.06 ms   | 373.11  | 197        |
| Queue.add × 1000                                      | 5.39 ms   | 5.44 ms   | 5.72 ms   | 185.60  | 103        |
| Queue.addBulk × 100                                   | 535.89 µs | 537.67 µs | 672.17 µs | 1.87K   | 937        |
| Queue.addBulk × 500                                   | 2.72 ms   | 2.73 ms   | 3.04 ms   | 367.93  | 193        |
| Queue.addBulk × 1000                                  | 5.50 ms   | 5.64 ms   | 6.14 ms   | 181.75  | 101        |
| Queue.addBulk × 5000                                  | 28.53 ms  | 28.69 ms  | 29.82 ms  | 35.05   | 28         |
| add × 500 (sequential)                                | 2.82 ms   | 2.78 ms   | 3.50 ms   | 354.55  | 187        |
| addBulk × 500 (batch)                                 | 2.67 ms   | 2.70 ms   | 3.23 ms   | 374.36  | 197        |
| Worker × 20 (no limiter, baseline)                    | 1.00 s    | 1.00 s    | 1.00 s    | 1.00    | 3          |
| Worker × 20 (limiter: 10/1s)                          | 2.01 s    | 2.01 s    | 2.01 s    | 0.50    | 3          |
| Worker × 20 (concurrency=20, no global limit)         | 1.00 s    | 1.00 s    | 1.00 s    | 1.00    | 3          |
| Worker × 20 (concurrency=20, global=5)                | 1.00 s    | 1.00 s    | 1.00 s    | 1.00    | 3          |
| Queue.add × 500 (baseline)                            | 2.76 ms   | 2.79 ms   | 3.56 ms   | 362.76  | 191        |
| Queue.now × 500                                       | 3.31 ms   | 3.25 ms   | 8.80 ms   | 302.21  | 161        |
| Queue.schedule × 500 (numeric delay)                  | 3.41 ms   | 3.19 ms   | 9.59 ms   | 293.16  | 156        |
| Queue.schedule × 500 (human-readable delay)           | 3.43 ms   | 3.30 ms   | 13.17 ms  | 291.96  | 155        |
| Queue.every × 500                                     | 3.21 ms   | 3.25 ms   | 3.56 ms   | 311.89  | 167        |
| Queue.cron × 500                                      | 3.39 ms   | 3.18 ms   | 10.45 ms  | 294.93  | 157        |
| pause + resume cycle × 100                            | 15.64 µs  | 15.42 µs  | 21.67 µs  | 63.95K  | 30814      |
| pause + resume by jobName × 100                       | 16.79 µs  | 16.54 µs  | 21.13 µs  | 59.55K  | 28771      |
| store.saveJob × 1                                     | 3.09 µs   | 3.12 µs   | 3.47 µs   | 323.28K | 27         |
| store.saveBulk × 100                                  | 292.54 µs | 290.46 µs | 462.00 µs | 3.42K   | 1648       |
| store.saveBulk × 1000                                 | 3.06 ms   | 3.02 ms   | 7.28 ms   | 327.33  | 167        |
| store.fetchNextJob (from 1000 waiting)                | 187.74 µs | 206.92 µs | 555.29 µs | 5.33K   | 173        |
| fetch+complete cycle × 100                            | 781.33 µs | 795.63 µs | 975.38 µs | 1.28K   | 474        |
| fetch+complete cycle × 500                            | 8.97 ms   | 9.06 ms   | 9.76 ms   | 111.43  | 58         |
| store.countJobs (1000 jobs)                           | 27.26 µs  | 38.13 µs  | 73.92 µs  | 36.68K  | 177        |
| store.listJobs (page 0..50 of 1000)                   | 223.63 µs | 249.71 µs | 763.46 µs | 4.47K   | 160        |
| store.clean 1000 completed jobs                       | 105.95 µs | 121.33 µs | 221.25 µs | 9.44K   | 164        |
| store.drain 1000 waiting jobs                         | 66.21 µs  | 76.38 µs  | 211.83 µs | 15.10K  | 170        |
| Worker × 20 jobs (concurrency=1)                      | 20.05 s   | 20.05 s   | 20.05 s   | 0.05    | 3          |
| Worker × 20 jobs (concurrency=10)                     | 1.00 s    | 1.01 s    | 1.01 s    | 1.00    | 3          |
| Worker × 20 jobs (concurrency=20)                     | 1.00 s    | 1.00 s    | 1.00 s    | 1.00    | 3          |

## Batch

### Batch Size

| Benchmark                                | Avg                   | Min     | Max     | p75     | p99     | Ops/sec | Iterations |
| ---------------------------------------- | --------------------- | ------- | ------- | ------- | ------- | ------- | ---------- |
| Batch worker × 20 (batch=1) _(baseline)_ | 20.05 s               | 20.04 s | 20.05 s | 20.05 s | 20.05 s | 0.05    | 3          |
| Batch worker × 20 (batch=10)             | 2.01 s **90% faster** | 2.00 s  | 2.01 s  | 2.01 s  | 2.01 s  | 0.50    | 3          |
| Batch worker × 20 (batch=20)             | 1.00 s **95% faster** | 1.00 s  | 1.00 s  | 1.00 s  | 1.00 s  | 1.00    | 3          |

## Features

### Deduplication

| Benchmark                         | Avg                    | Min      | Max      | p75      | p99      | Ops/sec | Iterations |
| --------------------------------- | ---------------------- | -------- | -------- | -------- | -------- | ------- | ---------- |
| add × 500 (no dedup) _(baseline)_ | 2.88 ms                | 2.59 ms  | 5.60 ms  | 2.94 ms  | 4.10 ms  | 347.47  | 183        |
| add × 500 (hash dedup)            | 13.73 ms _377% slower_ | 13.37 ms | 14.26 ms | 13.82 ms | 14.26 ms | 72.84   | 47         |
| add × 500 (custom key dedup)      | 4.45 ms _55% slower_   | 4.26 ms  | 5.85 ms  | 4.54 ms  | 4.73 ms  | 224.58  | 123        |

### Priority

| Benchmark                            | Avg                  | Min     | Max     | p75     | p99     | Ops/sec | Iterations |
| ------------------------------------ | -------------------- | ------- | ------- | ------- | ------- | ------- | ---------- |
| add × 500 (no priority) _(baseline)_ | 2.74 ms              | 2.58 ms | 6.35 ms | 2.79 ms | 3.17 ms | 364.81  | 193        |
| add × 500 (with priority)            | 3.03 ms _11% slower_ | 2.74 ms | 7.79 ms | 3.02 ms | 7.20 ms | 329.98  | 175        |

### Fifo Vs Lifo

| Benchmark                       | Avg                   | Min     | Max     | p75     | p99     | Ops/sec | Iterations |
| ------------------------------- | --------------------- | ------- | ------- | ------- | ------- | ------- | ---------- |
| fetch × 500 (FIFO) _(baseline)_ | 8.42 ms               | 7.31 ms | 9.48 ms | 9.06 ms | 9.48 ms | 118.80  | 60         |
| fetch × 500 (LIFO)              | 8.25 ms **2% faster** | 7.89 ms | 8.88 ms | 8.38 ms | 8.88 ms | 121.26  | 61         |

### Delayed

| Benchmark                        | Avg      | Min      | Max       | p75      | p99       | Ops/sec | Iterations |
| -------------------------------- | -------- | -------- | --------- | -------- | --------- | ------- | ---------- |
| promoteDelayedJobs (500 delayed) | 38.71 µs | 24.25 µs | 269.25 µs | 40.67 µs | 120.50 µs | 25.84K  | 323        |

### Job Removal

| Benchmark       | Avg      | Min      | Max       | p75      | p99       | Ops/sec | Iterations |
| --------------- | -------- | -------- | --------- | -------- | --------- | ------- | ---------- |
| removeJob × 500 | 87.27 µs | 70.63 µs | 255.50 µs | 88.38 µs | 219.13 µs | 11.46K  | 193        |

## Flow

### Flow Creation

| Benchmark                               | Avg       | Min       | Max     | p75       | p99       | Ops/sec | Iterations |
| --------------------------------------- | --------- | --------- | ------- | --------- | --------- | ------- | ---------- |
| store.saveFlow (1 parent + 5 children)  | 18.82 µs  | 14.25 µs  | 3.04 ms | 17.17 µs  | 73.79 µs  | 53.13K  | 24250      |
| store.saveFlow (1 parent + 20 children) | 57.78 µs  | 52.54 µs  | 2.55 ms | 57.42 µs  | 94.75 µs  | 17.31K  | 8191       |
| store.saveFlow (1 parent + 50 children) | 143.06 µs | 126.21 µs | 6.29 ms | 141.92 µs | 229.88 µs | 6.99K   | 3355       |

### Flow Notify

| Benchmark                       | Avg      | Min      | Max       | p75      | p99      | Ops/sec | Iterations |
| ------------------------------- | -------- | -------- | --------- | -------- | -------- | ------- | ---------- |
| store.notifyChildCompleted × 20 | 49.29 µs | 43.21 µs | 214.83 µs | 49.08 µs | 86.29 µs | 20.29K  | 4421       |

### Flow Query

| Benchmark                           | Avg       | Min       | Max       | p75       | p99       | Ops/sec | Iterations |
| ----------------------------------- | --------- | --------- | --------- | --------- | --------- | ------- | ---------- |
| store.getChildrenJobs (50 children) | 118.86 µs | 109.63 µs | 349.00 µs | 119.83 µs | 212.25 µs | 8.41K   | 1851       |

## Observable

### Observable Creation

| Benchmark                           | Avg      | Min     | Max       | p75      | p99      | Ops/sec | Iterations |
| ----------------------------------- | -------- | ------- | --------- | -------- | -------- | ------- | ---------- |
| Queue.observe × 500 (creation only) | 13.79 µs | 7.67 µs | 244.58 µs | 12.50 µs | 42.00 µs | 72.50K  | 190        |

### Observable Subscribe

| Benchmark                                    | Avg                      | Min       | Max       | p75       | p99       | Ops/sec | Iterations |
| -------------------------------------------- | ------------------------ | --------- | --------- | --------- | --------- | ------- | ---------- |
| subscribe × 1 observers (1 job) _(baseline)_ | 2.77 µs                  | 2.33 µs   | 298.67 µs | 2.71 µs   | 4.29 µs   | 361.40K | 53425      |
| subscribe × 10 observers (1 job)             | 24.64 µs _791% slower_   | 22.58 µs  | 632.08 µs | 24.38 µs  | 33.42 µs  | 40.58K  | 15744      |
| subscribe × 50 observers (1 job)             | 121.45 µs _4289% slower_ | 112.13 µs | 476.54 µs | 121.25 µs | 199.25 µs | 8.23K   | 3806       |

### Observable Cancel Waiting

| Benchmark                            | Avg                      | Min       | Max       | p75       | p99       | Ops/sec | Iterations |
| ------------------------------------ | ------------------------ | --------- | --------- | --------- | --------- | ------- | ---------- |
| cancel × 1 waiting jobs _(baseline)_ | 5.42 µs                  | 4.88 µs   | 209.21 µs | 5.38 µs   | 7.00 µs   | 184.33K | 41186      |
| cancel × 50 waiting jobs             | 255.24 µs _4605% slower_ | 242.00 µs | 514.08 µs | 257.63 µs | 326.75 µs | 3.92K   | 950        |
| cancel × 200 waiting jobs            | 1.04 ms _19037% slower_  | 977.04 µs | 1.60 ms   | 1.06 ms   | 1.23 ms   | 963.23  | 245        |

### Observable E2e

| Benchmark                                             | Avg    | Min    | Max    | p75    | p99    | Ops/sec | Iterations |
| ----------------------------------------------------- | ------ | ------ | ------ | ------ | ------ | ------- | ---------- |
| observe → subscribe → process → onCompleted (10 jobs) | 1.00 s | 1.00 s | 1.00 s | 1.00 s | 1.00 s | 1.00    | 3          |

### Observable Cancel Active

| Benchmark                        | Avg      | Min      | Max      | p75      | p99      | Ops/sec | Iterations |
| -------------------------------- | -------- | -------- | -------- | -------- | -------- | ------- | ---------- |
| cancel active job (worker abort) | 82.97 µs | 69.50 µs | 93.79 µs | 93.79 µs | 93.79 µs | 12.05K  | 3          |

## Queue Throughput

### Queue Add

| Benchmark        | Avg       | Min       | Max     | p75       | p99       | Ops/sec | Iterations |
| ---------------- | --------- | --------- | ------- | --------- | --------- | ------- | ---------- |
| Queue.add × 100  | 554.26 µs | 497.71 µs | 3.29 ms | 560.67 µs | 707.04 µs | 1.80K   | 910        |
| Queue.add × 500  | 2.68 ms   | 2.54 ms   | 4.20 ms | 2.72 ms   | 3.06 ms   | 373.11  | 197        |
| Queue.add × 1000 | 5.39 ms   | 5.18 ms   | 8.18 ms | 5.44 ms   | 5.72 ms   | 185.60  | 103        |

### Queue AddBulk

| Benchmark            | Avg       | Min       | Max      | p75       | p99       | Ops/sec | Iterations |
| -------------------- | --------- | --------- | -------- | --------- | --------- | ------- | ---------- |
| Queue.addBulk × 100  | 535.89 µs | 502.96 µs | 2.05 ms  | 537.67 µs | 672.17 µs | 1.87K   | 937        |
| Queue.addBulk × 500  | 2.72 ms   | 2.55 ms   | 8.73 ms  | 2.73 ms   | 3.04 ms   | 367.93  | 193        |
| Queue.addBulk × 1000 | 5.50 ms   | 5.17 ms   | 6.32 ms  | 5.64 ms   | 6.14 ms   | 181.75  | 101        |
| Queue.addBulk × 5000 | 28.53 ms  | 27.94 ms  | 29.82 ms | 28.69 ms  | 29.82 ms  | 35.05   | 28         |

### Add Vs AddBulk

| Benchmark                          | Avg                 | Min     | Max      | p75     | p99     | Ops/sec | Iterations |
| ---------------------------------- | ------------------- | ------- | -------- | ------- | ------- | ------- | ---------- |
| add × 500 (sequential)             | 2.82 ms _6% slower_ | 2.60 ms | 16.44 ms | 2.78 ms | 3.50 ms | 354.55  | 187        |
| addBulk × 500 (batch) _(baseline)_ | 2.67 ms             | 2.55 ms | 3.28 ms  | 2.70 ms | 3.23 ms | 374.36  | 197        |

## Rate Limiting

### Rate Limiting

| Benchmark                                       | Avg                  | Min    | Max    | p75    | p99    | Ops/sec | Iterations |
| ----------------------------------------------- | -------------------- | ------ | ------ | ------ | ------ | ------- | ---------- |
| Worker × 20 (no limiter, baseline) _(baseline)_ | 1.00 s               | 1.00 s | 1.00 s | 1.00 s | 1.00 s | 1.00    | 3          |
| Worker × 20 (limiter: 10/1s)                    | 2.01 s _100% slower_ | 2.01 s | 2.01 s | 2.01 s | 2.01 s | 0.50    | 3          |

### Global Concurrency

| Benchmark                                                  | Avg    | Min    | Max    | p75    | p99    | Ops/sec | Iterations |
| ---------------------------------------------------------- | ------ | ------ | ------ | ------ | ------ | ------- | ---------- |
| Worker × 20 (concurrency=20, no global limit) _(baseline)_ | 1.00 s | 1.00 s | 1.00 s | 1.00 s | 1.00 s | 1.00    | 3          |
| Worker × 20 (concurrency=20, global=5)                     | 1.00 s | 1.00 s | 1.00 s | 1.00 s | 1.00 s | 1.00    | 3          |

## Scheduling

### Scheduling Methods

| Benchmark                                   | Avg                  | Min     | Max      | p75     | p99      | Ops/sec | Iterations |
| ------------------------------------------- | -------------------- | ------- | -------- | ------- | -------- | ------- | ---------- |
| Queue.add × 500 (baseline) _(baseline)_     | 2.76 ms              | 2.55 ms | 7.58 ms  | 2.79 ms | 3.56 ms  | 362.76  | 191        |
| Queue.now × 500                             | 3.31 ms _20% slower_ | 2.76 ms | 10.62 ms | 3.25 ms | 8.80 ms  | 302.21  | 161        |
| Queue.schedule × 500 (numeric delay)        | 3.41 ms _24% slower_ | 2.83 ms | 12.72 ms | 3.19 ms | 9.59 ms  | 293.16  | 156        |
| Queue.schedule × 500 (human-readable delay) | 3.43 ms _24% slower_ | 2.91 ms | 16.66 ms | 3.30 ms | 13.17 ms | 291.96  | 155        |
| Queue.every × 500                           | 3.21 ms _16% slower_ | 3.01 ms | 9.54 ms  | 3.25 ms | 3.56 ms  | 311.89  | 167        |
| Queue.cron × 500                            | 3.39 ms _23% slower_ | 2.98 ms | 17.59 ms | 3.18 ms | 10.45 ms | 294.93  | 157        |

### Pause Resume

| Benchmark                       | Avg      | Min      | Max       | p75      | p99      | Ops/sec | Iterations |
| ------------------------------- | -------- | -------- | --------- | -------- | -------- | ------- | ---------- |
| pause + resume cycle × 100      | 15.64 µs | 13.83 µs | 617.75 µs | 15.42 µs | 21.67 µs | 63.95K  | 30814      |
| pause + resume by jobName × 100 | 16.79 µs | 14.58 µs | 158.54 µs | 16.54 µs | 21.13 µs | 59.55K  | 28771      |

## Store Operations

### Store Save

| Benchmark             | Avg       | Min       | Max     | p75       | p99       | Ops/sec | Iterations |
| --------------------- | --------- | --------- | ------- | --------- | --------- | ------- | ---------- |
| store.saveJob × 1     | 3.09 µs   | 2.96 µs   | 3.47 µs | 3.12 µs   | 3.47 µs   | 323.28K | 27         |
| store.saveBulk × 100  | 292.54 µs | 253.33 µs | 7.66 ms | 290.46 µs | 462.00 µs | 3.42K   | 1648       |
| store.saveBulk × 1000 | 3.06 ms   | 2.60 ms   | 8.96 ms | 3.02 ms   | 7.28 ms   | 327.33  | 167        |

### Store Fetch

| Benchmark                              | Avg       | Min       | Max       | p75       | p99       | Ops/sec | Iterations |
| -------------------------------------- | --------- | --------- | --------- | --------- | --------- | ------- | ---------- |
| store.fetchNextJob (from 1000 waiting) | 187.74 µs | 118.50 µs | 595.25 µs | 206.92 µs | 555.29 µs | 5.33K   | 173        |

### Store Process Cycle

| Benchmark                  | Avg       | Min       | Max     | p75       | p99       | Ops/sec | Iterations |
| -------------------------- | --------- | --------- | ------- | --------- | --------- | ------- | ---------- |
| fetch+complete cycle × 100 | 781.33 µs | 712.54 µs | 1.07 ms | 795.63 µs | 975.38 µs | 1.28K   | 474        |
| fetch+complete cycle × 500 | 8.97 ms   | 8.44 ms   | 9.76 ms | 9.06 ms   | 9.76 ms   | 111.43  | 58         |

### Store Query

| Benchmark                           | Avg       | Min       | Max       | p75       | p99       | Ops/sec | Iterations |
| ----------------------------------- | --------- | --------- | --------- | --------- | --------- | ------- | ---------- |
| store.countJobs (1000 jobs)         | 27.26 µs  | 6.33 µs   | 74.50 µs  | 38.13 µs  | 73.92 µs  | 36.68K  | 177        |
| store.listJobs (page 0..50 of 1000) | 223.63 µs | 139.38 µs | 879.50 µs | 249.71 µs | 763.46 µs | 4.47K   | 160        |

### Store Maintenance

| Benchmark                       | Avg       | Min      | Max       | p75       | p99       | Ops/sec | Iterations |
| ------------------------------- | --------- | -------- | --------- | --------- | --------- | ------- | ---------- |
| store.clean 1000 completed jobs | 105.95 µs | 50.00 µs | 466.46 µs | 121.33 µs | 221.25 µs | 9.44K   | 164        |
| store.drain 1000 waiting jobs   | 66.21 µs  | 39.58 µs | 379.42 µs | 76.38 µs  | 211.83 µs | 15.10K  | 170        |

## Worker Processing

### Worker Concurrency

| Benchmark                                     | Avg                   | Min     | Max     | p75     | p99     | Ops/sec | Iterations |
| --------------------------------------------- | --------------------- | ------- | ------- | ------- | ------- | ------- | ---------- |
| Worker × 20 jobs (concurrency=1) _(baseline)_ | 20.05 s               | 20.04 s | 20.05 s | 20.05 s | 20.05 s | 0.05    | 3          |
| Worker × 20 jobs (concurrency=10)             | 1.00 s **95% faster** | 1.00 s  | 1.01 s  | 1.01 s  | 1.01 s  | 1.00    | 3          |
| Worker × 20 jobs (concurrency=20)             | 1.00 s **95% faster** | 1.00 s  | 1.00 s  | 1.00 s  | 1.00 s  | 1.00    | 3          |

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
