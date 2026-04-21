-- Decrement a parent's pending-children counter; transition to `waiting`
-- when it reaches zero.
--
-- KEYS[1] = parent hash
-- KEYS[2] = parent's waiting-children list
-- KEYS[3] = parent's waiting list
--
-- ARGV[1] = parentId
-- ARGV[2] = groupPrefix         ("{conveyor:q}:group:")
-- ARGV[3] = groupWaitingSuffix  (":waiting")
-- ARGV[4] = now (ms) — score for the group-waiting ZSET entry
--
-- Returns the parent's new state as a string:
--   - "completed" if the parent no longer exists (matches MemoryStore).
--   - the existing state when the counter stays above zero.
--   - "waiting" once every child has reported back.
if redis.call('EXISTS', KEYS[1]) == 0 then
  return 'completed'
end

local raw = redis.call('HGET', KEYS[1], 'pendingChildrenCount')
local count = tonumber(raw) or 0
local newCount = count - 1

if newCount > 0 then
  redis.call('HSET', KEYS[1], 'pendingChildrenCount', tostring(newCount))
  local state = redis.call('HGET', KEYS[1], 'state')
  if type(state) == 'string' then return state end
  return 'waiting-children'
end

-- Counter hit zero: flip the parent into `waiting`, move it across the
-- state-index buckets, and re-register it on the group-waiting ZSET if
-- it carries a groupId. Clamp `pendingChildrenCount` to 0 so a stale
-- re-entry doesn't push it negative.
redis.call('HSET', KEYS[1], 'pendingChildrenCount', '0', 'state', 'waiting')
redis.call('LREM', KEYS[2], 0, ARGV[1])
redis.call('RPUSH', KEYS[3], ARGV[1])

local gid = redis.call('HGET', KEYS[1], 'groupId')
if type(gid) == 'string' and gid ~= '' then
  redis.call('ZADD', ARGV[2] .. gid .. ARGV[3], ARGV[4], ARGV[1])
end

return 'waiting'
