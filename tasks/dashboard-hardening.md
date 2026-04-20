# Dashboard Hardening

## Status

done

## Goal

Close product gaps identified in dashboard review: mode awareness, error handling, form/option
parity with engine, and basic ops primitives (export). Workers view, OpenTelemetry, a11y, and i18n
are out of scope (blocked on core or transverse).

## Scope

- [x] In: readOnly UI awareness, 401/403 global handling, full Job form options, CSV/JSON export,
      PRD doc cleanup.
- [ ] Out: workers view (needs core worker registry), OpenTelemetry (Phase 4
      next-release-candidate), server-side queue search, accessibility pass, i18n, saved searches.

## Items

### 1. readOnly UI awareness

- [x] Add `GET /api/config` returning `{ readOnly, authRequired }`.
- [x] Expose `getConfig()` on `ConveyorDashboardClient`.
- [x] Fetch config once on app mount via `ConfigProvider` / `useConfig()`.
- [x] Hide mutation controls across queue, job, home pages + bulk action bar.
- [x] `read-only` badge in header when mode is active.

### 2. 401/403 auth error handler

- [x] Install `authAwareFetch` wrapper in `api/client.ts`; toast once per 5s window on 401/403.
- [x] SSE: cap reconnect attempts (5) via new `maxReconnectAttempts` option on `SubscribeOptions`;
      toast via `onGiveUp` callback.

### 3. Job form: full options

- [x] Rewritten `job-add-dialog.tsx` with collapsible Advanced section covering `jobId`, `lifo`,
      `backoff`, `repeat` (cron/every/limit/tz), `deduplication` (key/hash/ttl),
      `removeOnComplete`/`removeOnFail`, `timeout`.

### 4. Export CSV/JSON

- [x] `utils/export.ts` — CSV (flat) and JSON serializers + blob download.
- [x] Reusable `ExportButton` component with dropdown.
- [x] Wired into queue tab view and advanced search results.

### 5. PRD cleanup

- [x] Flipped `- [ ] Web dashboard UI` in `prd.md` Phase 6 to `- [x]`.

## Testing

- Backend: dashboard-api conformance for new `/api/config` endpoint (readOnly + authRequired in
  response).
- Client: unit test for 401/403 interceptor dispatch.
- UI: smoke-test readOnly mode — mutation buttons hidden/disabled.
- Manual: run dashboard in readOnly mode, confirm no console errors, all mutations gated; run with
  broken token, confirm toast + banner.

## Verification Before Merge

- [ ] `deno task fmt`
- [ ] `deno task lint`
- [ ] `deno task check`
- [ ] `deno task test:dashboard-api`
- [ ] `deno task test:dashboard-client`
- [ ] Manual UI smoke test in readOnly + broken-auth modes

## Review

What worked:

- Hono registration order allowed `/api/config` to bypass the auth middleware without a dedicated
  skip hook.
- Passing a custom `fetch` into `ConveyorDashboardClient` gave a single interception point for
  401/403 without touching each call site.
- `maxReconnectAttempts` + `onGiveUp` are forward-compatible additions to `SubscribeOptions`;
  defaults preserve existing behavior.

What didn't:

- Live input validation for cron/every strings was skipped — the backend already validates on insert
  and surfaces the error via toast. Adding client validation would duplicate `croner` parsing in the
  UI.
- Export is limited to the currently loaded page. A full-result export would require server-side
  streaming; out of scope here.
