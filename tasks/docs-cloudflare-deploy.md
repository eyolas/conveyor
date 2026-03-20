# Docs Cloudflare Pages Deployment

## Status

planned

---

## Context

The VitePress documentation site is built and ready (PR #25 merged). It needs to be deployed to
Cloudflare Pages (free tier: unlimited bandwidth, 500 builds/month, 1 concurrent build).

**Strategy: Hybrid deployment**

- Auto-deploy on release (tag `v*`) — ensures docs stay in sync with published versions
- Manual trigger (`workflow_dispatch`) — allows hotfixing typos/docs without a release

## Prerequisites

- [ ] Create Cloudflare Pages project (name: `conveyor-docs` or similar)
- [ ] Generate Cloudflare API token with Pages deployment permissions
- [ ] Add GitHub secrets: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`
- [ ] Configure custom domain `conveyor.run` in Cloudflare Pages (DNS)

## Phase 1: GitHub Actions Workflow

- [ ] Create `.github/workflows/deploy-docs.yml`
  - Triggers:
    - `push.tags: ['v*']` (auto on release)
    - `workflow_dispatch` (manual for hotfixes)
  - Steps:
    1. Checkout repo
    2. Setup Node.js (VitePress needs npm)
    3. `cd docs && npm ci && npm run build`
    4. Deploy to Cloudflare Pages via `cloudflare/wrangler-action`
       - Project name: `conveyor-docs`
       - Directory: `docs/.vitepress/dist`
- [ ] Pin all action versions with SHA (project convention)

## Phase 2: Version Sync

- [ ] Ensure `docs/.vitepress/config.ts` nav version (`v0.4.0`) gets updated during release
  - Option A: sed/replace in the deploy workflow using the tag
  - Option B: read version from root `deno.json` at build time
  - Prefer **Option B** — dynamic, no manual update needed

## Phase 3: Polish

- [ ] Add OG meta tags in VitePress config for social sharing
- [ ] Verify sitemap generation points to `conveyor.run`
- [ ] Add deploy status badge to README

## Notes

- Cloudflare Pages free tier: unlimited bandwidth, 500 builds/month, 1 concurrent build
- The existing `publish.yml` workflow handles JSR publish + GitHub Release — docs deploy is a
  **separate workflow** to keep concerns decoupled (shared trigger on `v*` but independent jobs)
- If Cloudflare Pages native GitHub integration is preferred over wrangler-action, the project can
  be connected directly in the Cloudflare dashboard — but the workflow approach gives more control
  (version injection, build validation)
