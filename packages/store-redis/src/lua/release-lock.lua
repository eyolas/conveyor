-- Release a job's lock without changing its state.
--
-- KEYS[1] = job hash
-- KEYS[2] = lock string key
-- KEYS[3] = active set
-- ARGV[1] = job id (member of the active set)
--
-- Always clears lockUntil / lockedBy on the hash, deletes the lock string,
-- and removes the id from the active set. Mirrors MemoryStore / PgStore:
-- releaseLock does not re-enqueue the job — the caller updates state
-- separately (updateJob → completed/failed, or the stalled sweep).
--
-- Returns 1 unconditionally (no "did the worker own it?" check — other
-- stores don't gate on ownership either, and only the owner calls this).
redis.call('HDEL', KEYS[1], 'lockUntil', 'lockedBy')
redis.call('DEL', KEYS[2])
redis.call('SREM', KEYS[3], ARGV[1])
return 1
