# Documentation Versioning

## How it works

- **Current major version** is always served at `conveyor.run`
- **Previous major versions** are served at `v{N}.conveyor.run` (e.g., `v1.conveyor.run`)
- The version selector dropdown in the docs nav is built from `docs/versions.json`

## When releasing a new major version

When a new major version is released (e.g., v2.0.0), the following steps are required:

### 1. Create a Cloudflare Pages project for the old version

Before releasing v2, the current docs (v1) must be archived:

1. Create a new Cloudflare Pages project named `conveyor-docs-v1`
2. Deploy the current docs to this new project
3. Add a custom domain `v1.conveyor.run` pointing to the `conveyor-docs-v1` project

### 2. Update `docs/versions.json`

Add the old version to the `versions` array with its URL:

```json
{
  "current": "v2",
  "versions": [
    { "text": "v1", "link": "https://v1.conveyor.run" }
  ]
}
```

### 3. Update the deploy workflow (if needed)

If the archived version needs its own deploy workflow, create a dedicated workflow
(e.g., `deploy-docs-v1.yml`) triggered only on the `v1` maintenance branch.

## Checklist for new major release

- [ ] Snapshot current docs to a `conveyor-docs-v{N}` Cloudflare Pages project
- [ ] Configure `v{N}.conveyor.run` custom domain in Cloudflare
- [ ] Update `docs/versions.json` — bump `current`, add old version to `versions` array
- [ ] Verify the version selector dropdown shows all versions correctly
- [ ] Verify old version subdomain resolves and serves correct docs
