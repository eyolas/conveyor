# Dashboard Hardening

## Status

in-progress

## Goal

Close product gaps identified in dashboard review: mode awareness, error handling,
form/option parity with engine, and basic ops primitives (export). Workers view,
OpenTelemetry, a11y, and i18n are out of scope (blocked on core or transverse).

## Scope

- [x] In: readOnly UI awareness, 401/403 global handling, full Job form options,
      CSV/JSON export, PRD doc cleanup.
- [ ] Out: workers view (needs core worker registry), OpenTelemetry (Phase 4
      next-release-candidate), server-side queue search, accessibility pass,
      i18n, saved searches.

## Items

### 1. readOnly UI awareness

Backend supports `readOnly` via `middleware/read-only.ts` which returns 403 on any
mutation. Frontend has no awareness and users still see mutation controls.

- [ ] Add `GET /api/config` returning `{ readOnly, authRequired, version }`.
- [ ] Expose `getConfig()` on `ConveyorDashboardClient`.
- [ ] Fetch config once on app mount; expose via a lightweight context/signal.
- [ ] Disable or hide mutation controls across:
  - `pages/queue.tsx` — pause / resume / drain / retry-all / promote-all / obliterate
  - `pages/job.tsx` — retry / promote / cancel / remove
  - `components/job-add-dialog.tsx` — add job button / form submit
- [ ] Visual marker in header when read-only (badge or banner).

### 2. 401/403 auth error handler

Client throws `ConveyorApiError` but no central handler. Each component does its
own try/catch. SSE has `onerror` but no auth-aware branch.

- [ ] Install a single interceptor (wrap client method in `api/client.ts`) that
      catches 401/403 and dispatches a toast + optional callback.
- [ ] On 401: toast "Session expired" and surface a global banner; stop SSE
      reconnection loops.
- [ ] On 403: toast "Forbidden — action blocked (read-only or permission
      denied)" without breaking the page.
- [ ] SSE: on repeated auth error, fall back to polling via
      `refetchInterval` on existing query paths, or stop silently with a banner.

### 3. Job form: full options

`components/job-add-dialog.tsx` only exposes `delay`, `priority`, `attempts`.
Backend accepts the entire `JobOptions` shape. Align UI.

- [ ] Extend form with collapsible "Advanced" section:
  - `jobId` (custom id — dedup)
  - `lifo` (checkbox)
  - `backoff` (type: fixed | exponential, delay ms)
  - `repeat` (cron | every, limit, startDate, endDate, tz)
  - `deduplication` (key, ttl)
  - `removeOnComplete` / `removeOnFail` (bool / age / count)
  - `timeout` (ms)
- [ ] Serialize form into `JobOptions` untouched; backend already accepts.
- [ ] Handle validation inline (e.g. invalid cron string).

### 4. Export CSV/JSON

No export path today. Users cannot extract a filtered job list.

- [ ] Add export menu on `pages/queue.tsx` (current tab) and `pages/search.tsx`
      (current filter).
- [ ] Export formats: CSV (flat columns) and JSON (raw JobData array).
- [ ] Client-side blob download — no backend endpoint needed for the first pass.
- [ ] Limit to the currently loaded page; document that limitation.

### 5. PRD cleanup

- [ ] Flip `- [ ] Web dashboard UI` in `prd.md` Phase 6 to `- [x]`.

## Testing

- Backend: dashboard-api conformance for new `/api/config` endpoint
  (readOnly + authRequired in response).
- Client: unit test for 401/403 interceptor dispatch.
- UI: smoke-test readOnly mode — mutation buttons hidden/disabled.
- Manual: run dashboard in readOnly mode, confirm no console errors, all
  mutations gated; run with broken token, confirm toast + banner.

## Verification Before Merge

- [ ] `deno task fmt`
- [ ] `deno task lint`
- [ ] `deno task check`
- [ ] `deno task test:dashboard-api`
- [ ] `deno task test:dashboard-client`
- [ ] Manual UI smoke test in readOnly + broken-auth modes

## Review

TBD — filled at completion.
