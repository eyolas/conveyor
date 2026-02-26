# Conveyor — Product Requirements Document

> 🚚 A multi-backend job queue for Node.js and Deno. BullMQ-like API with PostgreSQL, SQLite, and
> in-memory support.

---

## 1. Vision

Conveyor est une bibliothèque TypeScript de job queue avec des backends de stockage
interchangeables. Elle vise à offrir une API familière (inspirée de BullMQ) sans imposer de
dépendance à Redis, en supportant PostgreSQL, SQLite et un store in-memory.

### Pourquoi Conveyor ?

- **BullMQ** est excellent mais impose Redis comme unique backend
- Les projets small-to-medium n'ont pas toujours Redis en infra
- PostgreSQL est souvent déjà dans la stack — pourquoi ajouter Redis juste pour les jobs ?
- SQLite est parfait pour le dev local, les CLI tools, et les apps embarquées
- Aucune solution actuelle ne propose une API unifiée multi-backend avec support Deno natif

### Principes directeurs

- **Zero lock-in** : changer de backend = changer une ligne de config
- **Familiar API** : si tu connais BullMQ, tu connais Conveyor
- **Runtime agnostic** : Deno 2 et Node.js first-class
- **Type-safe** : TypeScript strict, generics sur les payloads
- **Testable** : le store in-memory rend les tests rapides et déterministes

---

## 2. Architecture

### Monorepo (Deno 2 workspaces)

```
conveyor/
├── deno.json                  # workspace root
├── packages/
│   ├── core/                  # @conveyor/core
│   │   ├── deno.json
│   │   └── src/
│   │       ├── mod.ts         # barrel export
│   │       ├── queue.ts       # Queue class
│   │       ├── worker.ts      # Worker class
│   │       ├── job.ts         # Job class
│   │       ├── scheduler.ts   # Delayed/repeated job scheduler
│   │       ├── events.ts      # Event emitter
│   │       └── types.ts       # Interfaces & types
│   ├── store-memory/          # @conveyor/store-memory
│   │   ├── deno.json
│   │   └── src/
│   │       ├── mod.ts
│   │       └── memory-store.ts
│   ├── store-pg/              # @conveyor/store-pg
│   │   ├── deno.json
│   │   └── src/
│   │       ├── mod.ts
│   │       ├── pg-store.ts
│   │       └── migrations/
│   └── store-sqlite/          # @conveyor/store-sqlite
│       ├── deno.json
│       └── src/
│           ├── mod.ts
│           └── sqlite-store.ts
└── examples/
    ├── basic/
    ├── with-pg/
    └── with-sqlite/
```

### Pattern Store (Adapter)

```
┌──────────────────────────────────┐
│          @conveyor/core          │
│  Queue · Worker · Job · Events   │
├──────────────────────────────────┤
│          StoreInterface          │
│  save · fetch · lock · update    │
│  remove · listByState · count    │
├──────────┬───────────┬───────────┤
│  Memory  │ PostgreSQL│  SQLite   │
└──────────┴───────────┴───────────┘
```

Le core ne dépend **jamais** d'un driver concret. Chaque store implémente `StoreInterface`.

---

## 3. API Surface

### 3.1 Queue

```typescript
import { Queue } from '@conveyor/core';
import { MemoryStore } from '@conveyor/store-memory';

const queue = new Queue<MyPayload>('email-sending', {
  store: new MemoryStore(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: true,
    removeOnFail: false,
  },
});

// Ajouter un job
const job = await queue.add('send-welcome', {
  to: 'user@example.com',
  template: 'welcome',
});

// Ajouter un job avec délai (ms ou human-readable)
await queue.add('send-reminder', payload, {
  delay: 60_000, // 1 minute
});

// Raccourcis schedule() et now()
await queue.schedule('in 10 minutes', 'send-reminder', payload);
await queue.schedule('tomorrow at 9am', 'daily-digest', payload);
await queue.now('send-welcome', payload); // exécution immédiate

// Ajouter un job récurrent (cron ou human-readable)
await queue.add('daily-report', payload, {
  repeat: { cron: '0 9 * * *' }, // tous les jours à 9h
});
await queue.every('2 hours', 'cleanup', payload); // human-readable
await queue.every('30 minutes', 'sync', payload);

// Ajouter un job avec priorité (plus bas = plus prioritaire)
await queue.add('urgent-task', payload, {
  priority: 1,
});

// Mode LIFO (dernier ajouté = premier traité)
await queue.add('lifo-job', payload, {
  lifo: true,
});

// Déduplication automatique par payload
await queue.add('send-email', payload, {
  deduplication: { hash: true }, // hash du payload pour dédup
});
await queue.add('send-email', payload, {
  deduplication: { key: 'user-123' }, // clé custom de dédup
});

// Bulk add
await queue.addBulk([
  { name: 'job-1', data: payload1 },
  { name: 'job-2', data: payload2, opts: { delay: 5000 } },
]);

// Gestion de la queue
await queue.pause(); // pause toute la queue
await queue.resume(); // reprend toute la queue
await queue.pause({ jobName: 'sync' }); // pause un job spécifique par nom
await queue.resume({ jobName: 'sync' }); // reprend un job spécifique
await queue.drain(); // supprime tous les jobs en attente
await queue.clean(grace); // supprime les vieux jobs completed/failed
await queue.close();
```

### 3.2 Worker

```typescript
import { Worker } from '@conveyor/core';

const worker = new Worker<MyPayload>(
  'email-sending',
  async (job) => {
    // Traitement du job
    await job.updateProgress(50);
    await sendEmail(job.data.to, job.data.template);
    await job.updateProgress(100);

    return { sent: true }; // résultat stocké sur job.returnvalue
  },
  {
    store: new MemoryStore(), // même store que la queue
    concurrency: 5,
    maxGlobalConcurrency: 50, // cap global cross-workers (optionnel)
    limiter: {
      max: 10, // max 10 jobs
      duration: 1000, // par seconde
    },
    lockDuration: 30_000, // 30s, renouvelé automatiquement
    stalledInterval: 30_000, // check stalled jobs toutes les 30s
  },
);

// Events
worker.on('completed', (job, result) => {/* ... */});
worker.on('failed', (job, error) => {/* ... */});
worker.on('progress', (job, progress) => {/* ... */});
worker.on('stalled', (jobId) => {/* ... */});
worker.on('error', (error) => {/* ... */});

await worker.close();
```

### 3.3 Job

```typescript
interface Job<T = unknown> {
  id: string;
  name: string;
  data: T;
  opts: JobOptions;

  // Lifecycle
  state: 'waiting' | 'delayed' | 'active' | 'completed' | 'failed';
  progress: number;
  returnvalue: unknown;
  failedReason: string | null;
  attemptsMade: number;

  // Timestamps
  createdAt: Date;
  processedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;

  // Methods
  updateProgress(progress: number): Promise<void>;
  log(message: string): Promise<void>;
  moveToFailed(error: Error): Promise<void>;
  retry(): Promise<void>;
  remove(): Promise<void>;
  isCompleted(): Promise<boolean>;
  isFailed(): Promise<boolean>;
  isActive(): Promise<boolean>;
}
```

### 3.4 JobOptions

```typescript
interface JobOptions {
  // Retry
  attempts?: number; // défaut: 1
  backoff?: {
    type: 'fixed' | 'exponential' | 'custom';
    delay: number; // ms
    customStrategy?: (attemptsMade: number) => number;
  };

  // Scheduling
  delay?: number | string; // ms ou human-readable ("5 minutes", "2 hours")
  repeat?: {
    cron?: string; // expression cron
    every?: number | string; // intervalle en ms ou human-readable
    limit?: number; // nombre max de répétitions
    startDate?: Date;
    endDate?: Date;
    tz?: string; // timezone (IANA)
  };

  // Priority & ordering
  priority?: number; // plus bas = plus prioritaire (défaut: 0)
  lifo?: boolean; // LIFO mode : dernier ajouté = premier traité (défaut: false)

  // Deduplication
  deduplication?: {
    hash?: boolean; // hash automatique du payload pour dédup
    key?: string; // clé custom de dédup
    ttl?: number; // durée de vie de la dédup en ms (évite les collisions tard)
  };

  // Lifecycle
  removeOnComplete?: boolean | number; // true, false, ou max age en ms
  removeOnFail?: boolean | number;

  // Timeout
  timeout?: number; // ms, job marqué failed si dépassé

  // Identifiant
  jobId?: string; // custom job ID (dédup manuelle)
}
```

### 3.5 Store Interface

```typescript
interface StoreInterface {
  // Lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  // Jobs CRUD
  saveJob(queueName: string, job: JobData): Promise<string>;
  saveBulk(queueName: string, jobs: JobData[]): Promise<string[]>;
  getJob(queueName: string, jobId: string): Promise<JobData | null>;
  updateJob(queueName: string, jobId: string, updates: Partial<JobData>): Promise<void>;
  removeJob(queueName: string, jobId: string): Promise<void>;

  // Deduplication
  findByDeduplicationKey(queueName: string, key: string): Promise<JobData | null>;

  // Locking / Fetching
  fetchNextJob(queueName: string, lockDuration: number, opts?: {
    lifo?: boolean; // inverse l'ordre de fetch
    jobName?: string; // filtre par nom de job
  }): Promise<JobData | null>;
  extendLock(queueName: string, jobId: string, duration: number): Promise<boolean>;
  releaseLock(queueName: string, jobId: string): Promise<void>;

  // Global concurrency
  getActiveCount(queueName: string): Promise<number>;

  // Queries
  listJobs(queueName: string, state: JobState, start?: number, end?: number): Promise<JobData[]>;
  countJobs(queueName: string, state: JobState): Promise<number>;

  // Delayed jobs
  getNextDelayedTimestamp(queueName: string): Promise<number | null>;
  promoteDelayedJobs(queueName: string, timestamp: number): Promise<number>;

  // Pause/Resume par job name
  pauseJobName(queueName: string, jobName: string): Promise<void>;
  resumeJobName(queueName: string, jobName: string): Promise<void>;
  getPausedJobNames(queueName: string): Promise<string[]>;

  // Maintenance
  getStalledJobs(queueName: string, stalledThreshold: number): Promise<JobData[]>;
  clean(queueName: string, state: JobState, grace: number): Promise<number>;
  drain(queueName: string): Promise<void>;

  // Events (couplé au store — Option A)
  // Chaque store utilise son mécanisme natif :
  // PG = LISTEN/NOTIFY, Memory = EventEmitter, SQLite = polling
  onEvent?(queueName: string, callback: (event: StoreEvent) => void): void;
}
```

---

## 4. Features détaillées

### 4.1 Job Lifecycle

```
             ┌──────────────────────────────────────────┐
             │                                          │
             ▼                                          │
add() → [waiting] ──fetch──→ [active] ──success──→ [completed]
             │                   │                      
             │                   ├──failure──→ [failed]  
             │                   │                 │     
             │                   │            retry?     
             │                   │                 │     
             │                   │     ┌───yes─────┘     
             │                   │     ▼                 
             │                   │  [waiting] (backoff delay)
             │                   │                       
             │              stalled?──→ [waiting] (réenqueue)
             │                                          
        delay > 0                                       
             │                                          
             ▼                                          
        [delayed] ──timer──→ [waiting]
```

### 4.2 Concurrence & Locking

- Chaque worker fetch N jobs simultanés (configurable via `concurrency`)
- Un job fetchté est **locké** pour une durée configurable
- Le lock est **renouvelé automatiquement** tant que le job est actif
- Si le lock expire (crash worker), le job est considéré **stalled** et réenqueué

**Implémentation par backend :**

| Mécanisme    | PostgreSQL                          | SQLite                   | Memory         |
| ------------ | ----------------------------------- | ------------------------ | -------------- |
| Lock         | `SELECT ... FOR UPDATE SKIP LOCKED` | `BEGIN IMMEDIATE` + flag | `Map` + mutex  |
| Notification | `LISTEN/NOTIFY`                     | Polling                  | `EventEmitter` |
| Atomicité    | Transactions                        | WAL mode + transactions  | Synchrone      |

### 4.3 Retry & Backoff

- **Fixed** : délai constant entre chaque tentative
- **Exponential** : `delay * 2^attempt` (avec jitter optionnel)
- **Custom** : fonction `(attemptsMade) => delayMs`

### 4.4 FIFO & LIFO

Par défaut, les jobs sont traités en **FIFO** (premier ajouté = premier traité). Le mode **LIFO**
(dernier ajouté = premier traité) est activable par job :

```typescript
await queue.add('recent-first', payload, { lifo: true });
```

Implémentation par backend :

- **Memory** : tri inversé sur `createdAt`
- **PostgreSQL** : `ORDER BY created_at DESC` au lieu de `ASC`
- **SQLite** : idem

### 4.5 Human-Readable Scheduling

En complément des valeurs en ms et des expressions cron, Conveyor supporte les intervalles en
langage naturel :

```typescript
// Méthodes dédiées
await queue.schedule('in 10 minutes', 'send-reminder', payload);
await queue.schedule('tomorrow at 9am', 'daily-digest', payload);
await queue.now('urgent-job', payload);
await queue.every('2 hours', 'cleanup', payload);
await queue.every('30 minutes', 'health-check', payload);

// Ou via les options
await queue.add('job', payload, { delay: '5 minutes' });
await queue.add('job', payload, { repeat: { every: '1 hour' } });
```

Parsing assuré par une lib compatible multi-runtime (type `ms` ou `human-interval`).

### 4.6 Job Deduplication

Conveyor empêche l'ajout de jobs dupliqués via deux mécanismes :

**Hash automatique du payload :**

```typescript
await queue.add('send-email', { to: 'a@b.com' }, {
  deduplication: { hash: true, ttl: 60_000 },
});
// Un second add avec le même payload dans les 60s sera ignoré (retourne le job existant)
```

**Clé custom :**

```typescript
await queue.add('process-user', data, {
  deduplication: { key: `user-${userId}`, ttl: 300_000 },
});
```

Le `ttl` permet d'éviter les collisions sur des jobs anciens déjà complétés. Sans `ttl`, la dédup
est permanente tant que le job existe dans le store.

### 4.7 Global Concurrency

En plus de la concurrence par worker (`concurrency`), Conveyor supporte un cap **global
cross-workers** :

```typescript
const worker = new Worker('queue', handler, {
  store,
  concurrency: 5, // max 5 jobs simultanés sur CE worker
  maxGlobalConcurrency: 50, // max 50 jobs actifs au total sur TOUS les workers
});
```

Implémentation par backend :

- **PostgreSQL** : `SELECT COUNT(*) FROM jobs WHERE state = 'active'` avant fetch (atomique via
  transaction)
- **SQLite** : même requête, single process donc trivial
- **Memory** : compteur in-memory

### 4.8 Pause/Resume par Job Name

En plus de pause/resume sur toute la queue, Conveyor permet de cibler un job spécifique par son nom
:

```typescript
await queue.pause({ jobName: 'send-email' }); // seuls les jobs "send-email" sont en pause
await queue.resume({ jobName: 'send-email' }); // reprend uniquement "send-email"

// Pause globale (comportement par défaut)
await queue.pause(); // toute la queue
await queue.resume();
```

Les jobs pausés par nom restent en state `waiting` mais sont exclus du fetch par les workers.

### 4.9 Repeated Jobs (Cron)

- Support des expressions cron standard (5 et 6 champs)
- Support `every` pour les intervalles simples
- Timezone-aware via IANA tz strings
- Déduplication automatique : un seul job scheduled par pattern
- Limitable en nombre de répétitions

### 4.10 Rate Limiting

```typescript
limiter: {
  max: 100,       // jobs max
  duration: 60000 // par minute
}
```

- Implémenté avec sliding window dans le store
- S'applique par worker (local) ou par queue (distribué, selon backend)

### 4.11 Events

```typescript
type QueueEvent =
  | 'waiting' // job ajouté à la queue
  | 'active' // job pris par un worker
  | 'completed' // job terminé avec succès
  | 'failed' // job échoué
  | 'progress' // progression mise à jour
  | 'stalled' // job stalé détecté
  | 'delayed' // job delayed ajouté
  | 'removed' // job supprimé
  | 'drained' // queue vidée
  | 'paused' // queue en pause
  | 'resumed' // queue reprise
  | 'error'; // erreur interne
```

### 4.12 Graceful Shutdown

```typescript
// Attend que les jobs actifs terminent (avec timeout)
await worker.close(/* forceTimeout: */ 10_000);
await queue.close();
```

---

## 5. Spécifications par Store

### 5.1 Memory Store (`@conveyor/store-memory`)

- **Usage** : tests, dev local, prototypage, CLI tools
- **Persistence** : aucune (perdu au restart)
- **Locking** : Map + mutex simple
- **Events** : `EventEmitter` natif
- **Performance** : la plus rapide, O(1) pour la plupart des opérations
- **Limitations** : single process uniquement, pas de distribution

### 5.2 PostgreSQL Store (`@conveyor/store-pg`)

- **Usage** : production, systèmes distribués
- **Persistence** : durable
- **Locking** : `SELECT ... FOR UPDATE SKIP LOCKED` (row-level)
- **Events** : `LISTEN/NOTIFY` pour notifications temps réel
- **Performance** : excellente avec index appropriés
- **Features bonus** : multi-worker distribué, JSONB pour les payloads
- **Version minimum** : PostgreSQL 12+
- **Driver** : `postgres` (deno-postgres) ou configurable

### 5.3 SQLite Store (`@conveyor/store-sqlite`)

- **Usage** : apps embarquées, Electron, dev local, edge/serverless
- **Persistence** : durable (fichier local)
- **Locking** : WAL mode + `BEGIN IMMEDIATE`
- **Events** : polling (configurable interval)
- **Performance** : très bonne en single-process
- **Limitations** : pas de distribution multi-process (lock fichier)
- **Driver** : Deno FFI SQLite ou `better-sqlite3` pour Node

---

## 6. Hors scope (V1)

Les features suivantes sont volontairement **exclues** de la V1 pour garder le scope maîtrisé :

- **Flows/dependencies** (job A dépend de job B) — V2
- **Dashboard/UI web** — V2
- **Store Redis** (ironie) — V2 si demandé par la communauté
- **Cloudflare D1 store** (nécessite un mode Worker pull/edge) — V2
- **Sandboxed workers** (process séparés) — V2
- **Metrics/observabilité intégrée** (OpenTelemetry) — V2
- **Job batching** (grouper N jobs en un seul traitement) — V2
- **Groups** (jobs groupés avec rate limit/concurrence par groupe) — V2
- **Observables** (jobs comme observables, annulation streamée) — V2
- **Notification channels découplés** (séparer notif du store, Option B) — V2
- **Dead letter queue** — V2

---

## 7. Compatibilité Runtime

| Runtime     | Support        | Notes                            |
| ----------- | -------------- | -------------------------------- |
| Deno 2+     | ✅ First-class | Workspace natif, JSR publish     |
| Node.js 18+ | ✅ First-class | Via `deno compile` ou JSR/npm    |
| Bun 1.1+    | ✅ First-class | Compatible via npm/JSR, testé CI |

### Contraintes multi-runtime

- **Aucune API runtime-spécifique dans le core** : pas de `Deno.*`, `Bun.*`, ou `process.*` dans
  `@conveyor/core`. Uniquement des Web Standards APIs (`setTimeout`, `EventTarget`,
  `crypto.randomUUID`, etc.)
- **Drivers par store** : chaque store adapter encapsule le driver spécifique au runtime (ex:
  `bun:sqlite` vs `better-sqlite3` vs Deno FFI SQLite). Le choix du driver est automatique ou
  configurable.
- **CI** : matrice GitHub Actions avec Deno, Node.js et Bun pour garantir la compatibilité sur les 3
  runtimes.

### Publication

- **JSR** (JavaScript Registry) : `@conveyor/core`, `@conveyor/store-*`
- **npm** : généré depuis Deno via `dnt` (Deno to Node Transform) ou publié directement sur JSR
  (compatible npm)

---

## 8. Testing Strategy

```
tests/
├── core/              # tests unitaires du core (mock store)
├── store-memory/      # tests de l'adapter memory
├── store-pg/          # tests avec PostgreSQL (testcontainers ou pg embarqué)
├── store-sqlite/      # tests avec SQLite
└── conformance/       # suite de tests commune à tous les stores
    └── store.test.ts  # vérifie le contrat StoreInterface
```

### Conformance Tests

Une **suite unique** de tests qui s'exécute contre **chaque store** pour garantir un comportement
identique :

- Ajout/récupération de jobs
- FIFO et LIFO ordering
- Locking et concurrence
- Global concurrency cap
- Retry et backoff
- Delayed jobs promotion
- Human-readable scheduling
- Job deduplication (hash + clé custom)
- Pause/Resume (global + par job name)
- Stalled jobs detection
- Clean et drain
- Events émis correctement

---

## 9. Roadmap

### Phase 1 — Foundation (MVP)

- [x] Monorepo Deno 2 + CI (Deno, Node, Bun)
- [x] `@conveyor/core` : Queue, Worker, Job, Events
- [x] `@conveyor/store-memory` : store in-memory complet
- [x] FIFO + LIFO mode
- [x] Human-readable scheduling (`schedule()`, `now()`, `every()`)
- [x] Job deduplication (hash payload + clé custom)
- [x] Pause/Resume par job name
- [x] Conformance test suite
- [x] Documentation de base + exemples

### Phase 2 — Persistent Stores

- [x] `@conveyor/store-pg` : PostgreSQL adapter
- [x] `@conveyor/store-sqlite` : SQLite adapter
- [x] Migrations automatiques (PG + SQLite)
- [x] Global concurrency (cross-workers)
- [x] Tests d'intégration (conformance + integration)

### Phase 3 — Production Ready

- [x] Rate limiting
- [x] Graceful shutdown
- [x] Repeated jobs (cron + human-readable)
- [ ] npm publish via JSR
- [ ] README complet + logo
- [ ] Benchmarks vs BullMQ

### Phase 4 — Ecosystem (V2)

- [ ] CI native Node.js et Bun (tests exécutés nativement sans Deno)
- [ ] Job flows / dependencies
- [ ] Dashboard UI web
- [ ] OpenTelemetry integration
- [ ] Store Redis (si demandé)
- [ ] Store Cloudflare D1 + mode Worker edge/pull
- [ ] Sandboxed workers
- [ ] Groups (rate limit / concurrence par groupe)
- [ ] Job batching
- [ ] Observables
- [ ] Notification channels découplés (Option B)

---

## 10. Métriques de succès

- **Conformance** : 100% de la test suite passe sur les 3 stores
- **API parity** : 90%+ des features BullMQ core couvertes
- **Performance** : ≤ 2x overhead vs BullMQ sur un benchmark standard (1000 jobs, 10 workers)
- **DX** : setup fonctionnel en < 5 lignes de code
- **Compatibilité** : fonctionne sans modification sur Deno 2 et Node.js 18+
