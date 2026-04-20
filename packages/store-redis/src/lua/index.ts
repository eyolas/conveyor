/**
 * @module @conveyor/store-redis/lua
 *
 * Registry of bundled Lua scripts. Scripts live next to this file as
 * `.lua` files so they stay reviewable in their native syntax; this
 * module loads them at connect time, hands them to the store for
 * `SCRIPT LOAD`, and exposes a narrow `ScriptName` union the store
 * uses to reference them.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** The bundled scripts. Add new ones here when a phase needs them. */
export type ScriptName = 'extendLock' | 'releaseLock' | 'promoteDelayed';

const SCRIPT_FILES: Record<ScriptName, string> = {
  extendLock: 'extend-lock.lua',
  releaseLock: 'release-lock.lua',
  promoteDelayed: 'promote-delayed.lua',
};

/**
 * Read every bundled Lua script from disk. Called once per `connect()`.
 *
 * Uses `node:fs/promises` + `import.meta.url` resolution so the same code
 * path works under Node, Deno, and Bun — no bundler-specific text imports,
 * no runtime-conditional branches.
 */
export async function loadScriptSources(): Promise<Record<ScriptName, string>> {
  const names = Object.keys(SCRIPT_FILES) as ScriptName[];
  const entries = await Promise.all(
    names.map(async (name) => {
      const filename = SCRIPT_FILES[name];
      const path = fileURLToPath(new URL(`./${filename}`, import.meta.url));
      const source = await readFile(path, 'utf8');
      return [name, source] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<ScriptName, string>;
}
