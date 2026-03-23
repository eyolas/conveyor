# Lessons Learned

Patterns and mistakes to avoid, updated after every correction.

---

## [2026-03-16] Always run `deno task check` before merging

**What happened:** PR #19 was merged with a type error — `publishEvent` used `QueueEventType`
(unprefixed: `'active'`, `'completed'`) instead of `StoreEventType` (prefixed: `'job:active'`,
`'job:completed'`). The tests passed because vitest doesn't enforce strict type checks at runtime,
but `deno check` (used in CI) caught it.

**Root cause:** Only ran `deno task lint` and `deno task test` locally, skipped `deno task check`.

**Rule:** Always run `deno task check` (type-check) in addition to lint and tests before marking a
task complete or merging a PR.

## [2026-03-16] Verify `replace_all` doesn't replace inside its own target

**What happened:** Using `replace_all` to replace
`(job as Partial<Pick<JobData, 'id'>>).id ??
generateId()` with `this.extractJobId(job)` also
replaced the body of the `extractJobId` method itself, creating infinite recursion.

**Root cause:** The `replace_all` flag applies to every occurrence in the file, including the
definition of the helper method that was just added.

**Rule:** After using `replace_all`, immediately verify the helper/target definition wasn't also
replaced. When adding a new method and using `replace_all` to update call sites, add the method
_after_ doing the replacement, or verify the method body is correct.

## [2026-03-16] Keep `deno.json` and `package.json` deps in sync

**What happened:** Upgraded vitest `^3` → `^4` in `deno.json` but forgot `package.json`. CI Node and
Bun jobs kept running vitest 3 while Deno used v4.

**Root cause:** This monorepo has two dependency manifests: `deno.json` (for Deno) and
`package.json` (for Node/Bun via `npm install`/`bun install`). Updating one doesn't update the
other.

**Rule:** When upgrading a shared dev dependency, always update **both** `deno.json` and
`package.json`, then regenerate all three lockfiles (`deno.lock`, `package-lock.json`, `bun.lockb`)
and verify they resolve the same version. Use clean temp directories to generate npm/bun lockfiles
since Deno's `node_modules/.deno` structure conflicts with `npm install`.

## [2026-03-23] Update PG migration tests when adding new migrations

**What happened:** Migrations v5 (`add_stacktrace`) and v6 (`add_discarded`) were added to
`packages/store-pg/src/migrations.ts` but `tests/store-pg/migrations.test.ts` still expected exactly
4 migrations. CI failed with `expected 6 to be 4` on three tests (idempotent, skip applied,
concurrent advisory lock).

**Root cause:** The migration test file hardcodes the expected count and version numbers. Adding new
migrations without updating the test breaks CI.

**Rule:** When adding a new PG migration, always update `tests/store-pg/migrations.test.ts` to
reflect the new total count and verify the new migration's version/name.
