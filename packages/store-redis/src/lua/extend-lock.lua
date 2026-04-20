-- Extend a job's lock iff the job is still `active`.
--
-- KEYS[1] = job hash
-- KEYS[2] = lock string key
-- ARGV[1] = new lockUntil epoch ms (written into the hash)
-- ARGV[2] = new TTL for the lock string, in ms
--
-- Returns 1 if the lock was extended, 0 if the job is no longer active.
-- Note: the hash is the source of truth for lockUntil. The lock string
-- exists so fetchNextJob can use `SET NX PX` at lease time; keeping its
-- TTL in sync with the hash keeps a later NX fetch honest.
local state = redis.call('HGET', KEYS[1], 'state')
if state ~= 'active' then
  return 0
end
redis.call('HSET', KEYS[1], 'lockUntil', ARGV[1])
redis.call('PEXPIRE', KEYS[2], ARGV[2])
return 1
