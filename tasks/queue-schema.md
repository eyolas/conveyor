# Queue Schema Definition (`@conveyor/schema`)

## Status

planned

---

## Overview

Declarative queue schema format — like OpenAPI but for job queues. Allows users to describe their
queues (payload structure, actions, metadata) in YAML or TypeScript, enabling the dashboard and
other tools to auto-generate UI from the schema.

Lives in the monorepo for now (`packages/schema/`), with the intention to extract as a standalone
project if it gains traction.

### Architecture

- **Format:** YAML/JSON with JSON Schema for payloads + `$ref`/`allOf` like OpenAPI
- **Components:** Reusable schema definitions referenced via `$ref: '#/components/Name'`
- **Validation:** Valibot (schema structure) + minimal built-in JSON Schema validator (payloads)
- **TS API:** `defineQueues()` with optional `fromValibot()` for type-safe payload definitions
- **Standalone:** No dependency on `@conveyor/core` or `@conveyor/shared`

### Decisions

| Decision              | Choice                    | Rationale                                            |
| --------------------- | ------------------------- | ---------------------------------------------------- |
| Validation lib        | Valibot (obligatory dep)  | ~1KB tree-shaked, modular, type-safe                 |
| Payload format        | JSON Schema               | Standard, UI generators exist, OpenAPI-compatible    |
| Reuse mechanism       | `$ref` + `allOf`          | Familiar OpenAPI pattern, avoids duplication         |
| YAML parsing          | `@std/yaml`               | Deno standard library, battle-tested                 |
| Valibot → JSON Schema | `@valibot/to-json-schema` | Official package                                     |
| JSON Schema validator | Built-in minimal subset   | Avoids ajv (~80KB), covers form generation needs     |
| Payload/jobs model    | Both coexist              | Queue-level payload = default, named jobs = override |

---

## Schema Format (YAML)

```yaml
version: 1

# Reusable components (like OpenAPI components/schemas)
components:
  EmailRecipient:
    type: object
    properties:
      to: { type: string, format: email }
      name: { type: string }
    required: [to]

  MoneyAmount:
    type: object
    properties:
      amount: { type: number }
      currency: { type: string, enum: [EUR, USD, GBP] }

queues:
  emails:
    description: Transactional email delivery
    tags: [notifications, critical]

    defaults:
      attempts: 3
      backoff: { type: exponential, delay: 1000 }
      timeout: 30_000
      removeOnComplete: true

    # Default payload for unnamed jobs
    payload:
      $ref: '#/components/EmailRecipient'

    # Named job types (override default payload)
    jobs:
      send-welcome:
        description: Welcome email for new signups
        payload:
          allOf:
            - $ref: '#/components/EmailRecipient'
            - type: object
              properties:
                template: { type: string }
        result:
          type: object
          properties:
            messageId: { type: string }

      send-invoice:
        description: Monthly invoice
        payload:
          type: object
          properties:
            recipient: { $ref: '#/components/EmailRecipient' }
            invoice: { $ref: '#/components/MoneyAmount' }
          required: [recipient, invoice]

    actions: [retry, remove, pause, resume]

  image-resize:
    description: Thumbnail generation
    tags: [media]

    payload:
      type: object
      properties:
        url: { type: string, format: uri }
        sizes: { type: array, items: { type: number } }
      required: [url]

    actions: [retry, remove, pause, resume, clean, drain]

    groups:
      - id: tenant
        description: Per-tenant processing
```

### Payload Resolution

- **Queue-level `payload`** = default for unnamed jobs (`queue.add(data)`)
- **Named `jobs`** = override for named jobs (`queue.add('send-welcome', data)`)
- Both coexist: queue payload = fallback, jobs = specific
- **`$ref`**: internal references to `#/components/<Name>` (resolved at load time)
- **`allOf`**: schema composition (like OpenAPI)

---

## Package Structure

```
packages/schema/
  deno.json
  src/
    mod.ts              # Barrel exports
    types.ts            # ConveyorSchema, QueueSchemaDefinition, etc.
    constants.ts        # ALLOWED_ACTIONS, SCHEMA_VERSION
    define.ts           # defineQueues() + fromValibot()
    load.ts             # loadSchema() — YAML/JSON -> ConveyorSchema
    resolve.ts          # $ref resolution (components -> inline)
    validate.ts         # Schema self-validation + validatePayload()
    serialize.ts        # toJSON(), toYAML()
```

Dependencies: `valibot@^1`, `@valibot/to-json-schema`, `@std/yaml@^1`

---

## Public API

```typescript
// Types
interface ConveyorSchema {
  version: SchemaVersion;
  components?: Record<string, JsonSchema>;
  queues: Record<string, QueueSchemaDefinition>;
}

// Load from YAML string or plain object
function loadSchema(input: string | Record<string, unknown>): ConveyorSchema;

// TypeScript-first definition
function defineQueues(options: DefineQueuesOptions): ConveyorSchema;

// Wrap a Valibot schema -> JSON Schema
function fromValibot(schema: BaseSchema): JsonSchema;

// Validate a job payload against the schema
function validatePayload(
  schema: ConveyorSchema,
  queueName: string,
  payload: unknown,
  jobName?: string,
): ValidationResult;

// Validate the schema structure itself
function validateSchema(input: unknown): ConveyorSchema;

// Serialization
function toJSON(schema: ConveyorSchema): string;
function toYAML(schema: ConveyorSchema): string;
```

### Usage (TypeScript)

```typescript
import { defineQueues, fromValibot } from '@conveyor/schema';
import * as v from 'valibot';

const schema = defineQueues({
  queues: {
    emails: {
      description: 'Transactional emails',
      jobs: {
        'send-welcome': {
          payload: fromValibot(v.object({
            to: v.pipe(v.string(), v.email()),
            name: v.string(),
          })),
        },
      },
      actions: ['retry', 'remove', 'pause', 'resume'],
    },
  },
});
```

---

## Payload Validation

Minimal built-in JSON Schema validator (not ajv — too heavy). Supported subset:

- `type`: string, number, integer, boolean, object, array, null
- `properties` + `required`
- `items` (arrays)
- `enum`
- `minimum`, `maximum`, `minLength`, `maxLength`
- `format`: email, uri, uuid, date-time (basic regex)

Sufficient for form generation and dashboard-side validation.

---

## Dashboard Integration (future)

- `DashboardOptions.schema?: ConveyorSchema | string`
- Endpoint `/api/schema` serving the schema as JSON
- Frontend consumes JSON for: typed columns, forms, actions, descriptions

---

## Phase 1: Core (MVP)

- [ ] Package setup (`deno.json`, add to workspace root)
- [ ] `types.ts` — all interfaces (with `components`)
- [ ] `constants.ts` — `ALLOWED_ACTIONS`, `SCHEMA_VERSION`
- [ ] `resolve.ts` — `$ref` resolution to `#/components/<Name>` + `allOf` merge
- [ ] `validate.ts` — schema structure validation with Valibot
- [ ] `load.ts` — `loadSchema()` parse YAML + resolve refs + validation
- [ ] `serialize.ts` — `toJSON()`, `toYAML()`
- [ ] `mod.ts` — barrel exports
- [ ] Tests: load valid/invalid YAML, $ref resolution, allOf merge, round-trip serialize, validation
      errors

## Phase 2: TS API + Payload Validation

- [ ] `define.ts` — `defineQueues()` + `fromValibot()`
- [ ] `validatePayload()` — minimal JSON Schema validator
- [ ] Tests: defineQueues plain + Valibot, payload validation

## Phase 3: Dashboard Integration

- [ ] `schema` option in `DashboardOptions`
- [ ] `/api/schema` endpoint
- [ ] UI helpers for form generation from JSON Schema

---

## Key Files to Modify

| File                    | Change                                            |
| ----------------------- | ------------------------------------------------- |
| `/deno.json`            | Add `./packages/schema` to workspace + import map |
| New: `packages/schema/` | Entire new package                                |
| `tasks/status.yml`      | Update queue-schema-definition status             |

## Verification

- `deno task check` passes with new package
- `deno task lint` + `deno task fmt` pass
- Unit tests: loadSchema, validateSchema, validatePayload, defineQueues, fromValibot, serialization
- Integration test: YAML -> loadSchema -> validatePayload -> toYAML round-trip
