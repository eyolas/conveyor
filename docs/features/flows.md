# Flows (Parent-Child Dependencies)

Conveyor supports job flows where a parent job waits for all its children to complete before being
processed. Flows are created atomically using `FlowProducer` and can span multiple queues with
nested tree structures.

## Quick Examples

### Basic Flow

```typescript
import { FlowProducer, Worker } from '@conveyor/core';

const flow = new FlowProducer({ store });

const result = await flow.add({
  name: 'assemble-report',
  queueName: 'reports',
  data: { reportId: 42 },
  children: [
    { name: 'fetch-sales', queueName: 'reports', data: { source: 'sales' } },
    { name: 'fetch-inventory', queueName: 'reports', data: { source: 'inv' } },
  ],
});

console.log(result.job.id); // parent job ID
console.log(result.children![0].job.id); // first child job ID
```

### Cross-Queue Children

Children can belong to different queues (same store instance):

```typescript
const result = await flow.add({
  name: 'process-order',
  queueName: 'orders',
  data: { orderId: 123 },
  children: [
    { name: 'charge-payment', queueName: 'payments', data: { amount: 99 } },
    { name: 'reserve-stock', queueName: 'inventory', data: { sku: 'ABC' } },
    { name: 'send-confirmation', queueName: 'emails', data: { to: 'user@example.com' } },
  ],
});
```

### Nested Trees (3+ Levels)

```typescript
const result = await flow.add({
  name: 'deploy',
  queueName: 'ops',
  data: { version: '2.0' },
  children: [
    {
      name: 'build',
      queueName: 'ops',
      data: { target: 'production' },
      children: [
        { name: 'compile', queueName: 'ops', data: { lang: 'ts' } },
        { name: 'lint', queueName: 'ops', data: { strict: true } },
      ],
    },
    { name: 'run-tests', queueName: 'ops', data: { suite: 'integration' } },
  ],
});
// compile + lint must finish -> build can run
// build + run-tests must finish -> deploy can run
```

### Accessing Parent and Children in Workers

```typescript
const worker = new Worker('reports', async (job) => {
  if (job.name === 'fetch-sales') {
    // Access parent info
    console.log(job.parentId); // parent job ID
    console.log(job.parentQueueName); // parent queue name
    return { sales: 1_000_000 };
  }

  if (job.name === 'assemble-report') {
    // Get child jobs and their return values
    const children = await job.getDependencies();
    const childValues = await job.getChildrenValues();
    return { total: childValues.reduce((sum, v) => sum + v.sales, 0) };
  }
}, { store });
```

## Failure Policies

Control what happens to the parent when a child fails:

```typescript
// Default: parent fails immediately when any child fails
await flow.add({
  name: 'parent',
  queueName: 'q',
  data: {},
  opts: { failParentOnChildFailure: 'fail' },
  children: [/* ... */],
});

// Ignore: parent proceeds when remaining children finish
await flow.add({
  name: 'parent',
  queueName: 'q',
  data: {},
  opts: { failParentOnChildFailure: 'ignore' },
  children: [/* ... */],
});

// Remove: parent is removed entirely if any child fails
await flow.add({
  name: 'parent',
  queueName: 'q',
  data: {},
  opts: { failParentOnChildFailure: 'remove' },
  children: [/* ... */],
});
```

| Policy             | Behavior                                                                        |
| ------------------ | ------------------------------------------------------------------------------- |
| `'fail'` (default) | Parent transitions to `failed` immediately when any child fails                 |
| `'ignore'`         | Parent proceeds when all remaining children finish; failed children are skipped |
| `'remove'`         | Parent is removed from the store if any child fails                             |

## API Reference

### `FlowProducer`

```typescript
import { FlowProducer } from '@conveyor/core';

const flow = new FlowProducer({ store });
const result = await flow.add(flowJob);
```

### FlowJob

| Field       | Type         | Required | Description                                           |
| ----------- | ------------ | -------- | ----------------------------------------------------- |
| `name`      | `string`     | Yes      | Job name                                              |
| `queueName` | `string`     | Yes      | Queue to add the job to                               |
| `data`      | `T`          | Yes      | Job payload                                           |
| `opts`      | `JobOptions` | No       | Job options (priority, retries, failure policy, etc.) |
| `children`  | `FlowJob[]`  | No       | Child jobs that must complete first                   |

### FlowResult

| Field      | Type                                   | Description                                 |
| ---------- | -------------------------------------- | ------------------------------------------- |
| `job`      | `{ id, name, queueName, data, state }` | The created job                             |
| `children` | `FlowResult[]`                         | Results for child jobs (mirrors input tree) |

## How It Works Internally

1. **Tree flattening**: `FlowProducer.add()` traverses the tree depth-first (children before
   parents). Each node is assigned an ID and linked to its parent.

2. **Atomic save**: all jobs are saved in a single `store.saveFlow()` call. This ensures the entire
   tree is persisted atomically -- no partial flows.

3. **State management**:
   - Leaf jobs start in `waiting` state.
   - Parent jobs start in `waiting-children` state with `pendingChildrenCount` set to the number of
     direct children.

4. **Child completion**: when a child job completes, the worker calls
   `store.notifyChildCompleted(parentQueueName, parentId)`, which decrements the parent's
   `pendingChildrenCount`. When it reaches 0, the parent transitions to `waiting`.

5. **Child failure**: handled according to the parent's `failParentOnChildFailure` policy.

## Caveats

- **All children share the same store.** Cross-queue flows work, but all queues must use the same
  store instance.
- **No circular dependencies.** The tree structure prevents cycles by design, but there is no
  runtime check for self-referencing job IDs.
- **Parent waits for direct children only.** A grandparent does not directly track grandchildren.
  The chain propagates level by level.
- **Failure policies are set on the parent**, not the children. All children of the same parent
  follow the same failure policy.
- **Retries on children** work normally. A child that fails and retries does not notify the parent
  until it either succeeds or exhausts all attempts.
- **Flow jobs support all standard JobOptions** (priority, delay, deduplication, etc.) on each node
  in the tree.

## See Also

- [Retry and Backoff](/features/retry-backoff) -- retries work on individual flow nodes
- [Events](/features/events) -- listen for `waiting-children`, `waiting`, `completed`, `failed`
- [Batching](/features/batching) -- batch workers also handle flow child notifications
