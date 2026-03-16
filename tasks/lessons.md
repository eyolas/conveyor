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

**What happened:** Using `replace_all` to replace `(job as Partial<Pick<JobData, 'id'>>).id ??
generateId()` with `this.extractJobId(job)` also replaced the body of the `extractJobId` method
itself, creating infinite recursion.

**Root cause:** The `replace_all` flag applies to every occurrence in the file, including the
definition of the helper method that was just added.

**Rule:** After using `replace_all`, immediately verify the helper/target definition wasn't also
replaced. When adding a new method and using `replace_all` to update call sites, add the method
*after* doing the replacement, or verify the method body is correct.
