# FlowProducer

The `FlowProducer` creates job flows -- parent-child dependency trees where a parent job waits for
all its children to complete before being processed. Supports nested trees (3+ levels) and
cross-queue children (same store instance).

```typescript
import { FlowProducer } from '@conveyor/core';
```

## Constructor

```typescript
new FlowProducer(options: FlowProducerOptions)
```

| Parameter       | Type             | Description              |
| --------------- | ---------------- | ------------------------ |
| `options.store` | `StoreInterface` | The store backend to use |

```typescript
const flow = new FlowProducer({ store });
```

## Methods

### add

Add a flow tree to the store atomically. Children are inserted first (bottom-up), then the parent.

```typescript
async add<T = unknown>(flowJob: FlowJob<T>): Promise<FlowResult<T>>
```

| Parameter | Type         | Description               |
| --------- | ------------ | ------------------------- |
| `flowJob` | `FlowJob<T>` | The root of the flow tree |

Returns a `FlowResult<T>` tree mirroring the input structure.

## Types

### FlowJob

A node in a flow tree, describing a job and its children.

```typescript
interface FlowJob<T = unknown> {
  /** Job name. */
  name: string;
  /** Queue to add the job to. */
  queueName: string;
  /** Job payload. */
  data: T;
  /** Optional job options. */
  opts?: JobOptions;
  /** Child jobs that must complete before this job is processed. */
  children?: FlowJob[];
}
```

### FlowResult

Result of adding a flow tree.

```typescript
interface FlowResult<T = unknown> {
  /** The created job summary. */
  job: { id: string; name: string; queueName: string; data: T; state: JobState };
  /** Results for child jobs. */
  children?: FlowResult[];
}
```

## Examples

### Basic Parent-Child Flow

```typescript
const flow = new FlowProducer({ store });

const result = await flow.add({
  name: 'send-report',
  queueName: 'reports',
  data: { reportId: 42 },
  children: [
    { name: 'fetch-sales', queueName: 'reports', data: { source: 'sales' } },
    { name: 'fetch-inventory', queueName: 'reports', data: { source: 'inventory' } },
  ],
});

console.log(result.job.id); // parent job ID
console.log(result.children![0].job.id); // first child job ID
```

The parent starts in `waiting-children` state. When both children complete, the parent automatically
transitions to `waiting` and gets picked up by a worker.

### Cross-Queue Flow

Children can be in different queues as long as they share the same store instance.

```typescript
const result = await flow.add({
  name: 'assemble-report',
  queueName: 'reports',
  data: { reportId: 42 },
  children: [
    { name: 'fetch-sales', queueName: 'data-pipeline', data: { source: 'sales' } },
    { name: 'fetch-inventory', queueName: 'data-pipeline', data: { source: 'inv' } },
    { name: 'generate-chart', queueName: 'rendering', data: { type: 'bar' } },
  ],
});
```

### Nested Tree (3+ Levels)

```typescript
const result = await flow.add({
  name: 'deploy',
  queueName: 'deployments',
  data: { version: '2.0' },
  children: [
    {
      name: 'build',
      queueName: 'ci',
      data: { target: 'production' },
      children: [
        { name: 'lint', queueName: 'ci', data: {} },
        { name: 'test', queueName: 'ci', data: { suite: 'unit' } },
      ],
    },
    { name: 'notify', queueName: 'notifications', data: { channel: 'slack' } },
  ],
});
```

### Child Failure Policies

Control what happens to the parent when a child fails using `failParentOnChildFailure` in the
parent's options.

```typescript
const result = await flow.add({
  name: 'parent',
  queueName: 'main',
  data: {},
  opts: { failParentOnChildFailure: 'ignore' }, // parent proceeds even if a child fails
  children: [
    { name: 'optional-task', queueName: 'main', data: {} },
    { name: 'required-task', queueName: 'main', data: {} },
  ],
});
```

| Policy             | Behavior                                                                    |
| ------------------ | --------------------------------------------------------------------------- |
| `'fail'` (default) | Parent fails immediately when any child fails                               |
| `'ignore'`         | Parent proceeds when remaining children finish; failed children are skipped |
| `'remove'`         | Parent is removed if any child fails                                        |

### Accessing Children Values in the Parent Worker

```typescript
const worker = new Worker('reports', async (job) => {
  // Get return values from all completed children
  const childValues = await job.getChildrenValues();
  // { "child-id-1": { data: [...] }, "child-id-2": { data: [...] } }

  const allData = Object.values(childValues);
  return generateReport(allData);
}, { store });
```
