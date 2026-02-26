<p align="center">
  <img src="https://raw.githubusercontent.com/eyolas/conveyor/main/assets/logo.jpeg" alt="Conveyor" width="120" />
</p>

# @conveyor/store-memory

In-memory storage backend for the [Conveyor](../../README.md) job queue. Zero dependencies, perfect
for testing and prototyping.

## Install

```ts
import { MemoryStore } from '@conveyor/store-memory';
```

## Usage

```ts
import { Queue, Worker } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';

const store = new MemoryStore();
await store.connect();

const queue = new Queue('tasks', { store });
await queue.add('my-job', { key: 'value' });

const worker = new Worker('tasks', async (job) => {
  console.log(job.data);
}, { store });

await worker.close();
await queue.close();
await store.disconnect();
```

## Limitations

- No persistence (data lost on restart)
- Single process only

For production use, see [`@conveyor/store-pg`](../store-pg) or
[`@conveyor/store-sqlite`](../store-sqlite).

## License

MIT
