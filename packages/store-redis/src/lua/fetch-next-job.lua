-- Atomically pick the next eligible job and lease it to a worker.
--
-- The script is the point of Lua in this store: paused filter, job-name
-- filter, rate-limit window, group cap, and lock acquisition must all be
-- evaluated against a snapshot that can't shift under us between check
-- and lease.
--
-- KEYS[1] = paused set
-- KEYS[2] = waiting list
-- KEYS[3] = active set
-- KEYS[4] = rate-limit ZSET (sliding window of lease timestamps)
--
-- Positional ARGV:
--   ARGV[1]  workerId
--   ARGV[2]  lockDurationMs
--   ARGV[3]  now (ms)
--   ARGV[4]  lifo ("1" = LIFO, "0" = FIFO)
--   ARGV[5]  jobName filter ("" = none)
--   ARGV[6]  rateLimitMax ("0" = disabled)
--   ARGV[7]  rateLimitWindowMs
--   ARGV[8]  groupConcurrency ("-1" = disabled)
--   ARGV[9]  excludeGroupsCount N
--   ARGV[10..9+N] excluded group ids
--   Then four prefixes + one batch size:
--   ARGV[10+N] jobHashPrefix       ("{conveyor:q}:job:")
--   ARGV[11+N] groupPrefix         ("{conveyor:q}:group:")
--   ARGV[12+N] groupActiveSuffix   (":active")
--   ARGV[13+N] groupWaitingSuffix  (":waiting")
--   ARGV[14+N] lockPrefix          ("{conveyor:q}:lock:")
--   ARGV[15+N] scanBatch           (max ids inspected per call, e.g. "200")
--
-- Returns the `HGETALL` reply for the leased job as a flat
-- `{k1, v1, k2, v2, ...}` array, or nil when nothing is fetchable. Returning
-- the hash inline saves a follow-up round trip and closes the theoretical
-- window where the job could disappear between lease and hydrate.
--
-- Limits (documented, deferred):
--   * Priority ordering is not modelled (waiting is a plain LIST).
--   * Group fairness uses first-fit rather than round-robin — good enough
--     with exclude + cap to prevent starvation; Phase 5 will revisit via
--     `groups:index`.
--   * Scan depth is bounded by ARGV scanBatch (default 200). A queue that
--     accumulates >200 non-eligible heads (all names paused / all groups
--     capped / etc.) may fail to surface a ready job deeper in the list
--     until the heads are drained. If we ever observe this in practice,
--     either iterate in a second script pass or migrate waiting to a ZSET
--     with priority keyed scoring.

local pausedKey    = KEYS[1]
local waitingKey   = KEYS[2]
local activeKey    = KEYS[3]
local rateLimitKey = KEYS[4]

local workerId     = ARGV[1]
local lockDur      = tonumber(ARGV[2])
local now          = tonumber(ARGV[3])
local lifo         = ARGV[4] == '1'
local nameFilter   = ARGV[5]
local rlMax        = tonumber(ARGV[6])
local rlWindow     = tonumber(ARGV[7])
local groupCap     = tonumber(ARGV[8])
local excludeCount = tonumber(ARGV[9])

local excludeSet = {}
for i = 1, excludeCount do
  excludeSet[ARGV[9 + i]] = true
end

local argBase            = 9 + excludeCount
local jobHashPrefix      = ARGV[argBase + 1]
local groupPrefix        = ARGV[argBase + 2]
local groupActiveSuffix  = ARGV[argBase + 3]
local groupWaitingSuffix = ARGV[argBase + 4]
local lockPrefix         = ARGV[argBase + 5]
local scanBatch          = tonumber(ARGV[argBase + 6])

-- 1. Global pause? Whole queue is sidelined.
if redis.call('SISMEMBER', pausedKey, '__all__') == 1 then
  return nil
end

-- 2. Rate limit sliding window. Trim expired entries first so ZCARD is
--    the current window count.
if rlMax > 0 then
  local windowStart = now - rlWindow
  redis.call('ZREMRANGEBYSCORE', rateLimitKey, '-inf', '(' .. tostring(windowStart))
  if tonumber(redis.call('ZCARD', rateLimitKey)) >= rlMax then
    return nil
  end
end

-- 3. Peek at the waiting list (no priority ordering in this phase).
local waitingLen = tonumber(redis.call('LLEN', waitingKey))
if waitingLen == 0 then
  return nil
end
local batch = math.min(waitingLen, scanBatch)

local candidates
if lifo then
  candidates = redis.call('LRANGE', waitingKey, -batch, -1)
else
  candidates = redis.call('LRANGE', waitingKey, 0, batch - 1)
end

-- Iteration order: LIFO walks the tail in reverse so the most recently
-- pushed id is inspected first.
local order = {}
if lifo then
  for i = #candidates, 1, -1 do order[#order + 1] = candidates[i] end
else
  order = candidates
end

local chosenId = nil
local chosenGid = nil
for _, id in ipairs(order) do
  local jobKey = jobHashPrefix .. id
  local fields = redis.call('HMGET', jobKey, 'name', 'groupId')
  local name = fields[1]
  local gid  = fields[2]

  if type(name) ~= 'string' then
    -- Ghost id: the hash is gone but the waiting entry survived. Self-heal
    -- by dropping it so future scans don't keep hitting the same dead id.
    redis.call('LREM', waitingKey, 0, id)
  else
    local ok = true
    if nameFilter ~= '' and name ~= nameFilter then ok = false end
    if ok and redis.call('SISMEMBER', pausedKey, name) == 1 then ok = false end
    if ok and type(gid) == 'string' and gid ~= '' then
      if excludeSet[gid] then ok = false end
      if ok and groupCap >= 0 then
        local gKey = groupPrefix .. gid .. groupActiveSuffix
        if tonumber(redis.call('SCARD', gKey)) >= groupCap then ok = false end
      end
    end

    if ok then
      chosenId = id
      if type(gid) == 'string' and gid ~= '' then chosenGid = gid end
      break
    end
  end
end

if not chosenId then
  return nil
end

-- 4. Remove the chosen id from the waiting list (unique ids → one entry)
--    and from its group-waiting ZSET if it carried a groupId.
redis.call('LREM', waitingKey, 0, chosenId)
if chosenGid ~= nil then
  redis.call('ZREM', groupPrefix .. chosenGid .. groupWaitingSuffix, chosenId)
end

-- 5. Acquire the lease. Claim side-effects in a fixed order so an outside
--    observer never sees "active set contains id" without a corresponding
--    lock string.
redis.call('SET', lockPrefix .. chosenId, workerId, 'PX', tostring(lockDur))
redis.call('SADD', activeKey, chosenId)

local lockUntil = now + lockDur
redis.call('HSET', jobHashPrefix .. chosenId,
  'state', 'active',
  'lockedBy', workerId,
  'lockUntil', tostring(lockUntil),
  'processedAt', tostring(now))

if chosenGid ~= nil then
  redis.call('SADD', groupPrefix .. chosenGid .. groupActiveSuffix, chosenId)
end

-- 6. Record the lease in the rate-limit window so the next call sees it.
--    Each lease needs a distinct member — otherwise re-leasing the same id
--    after a stall sweep would just overwrite the existing score and the
--    window would undercount events. Using `now:id` guarantees uniqueness
--    (the lock prevents same-ms double-lease of the same id by design).
if rlMax > 0 then
  redis.call('ZADD', rateLimitKey, tostring(now), tostring(now) .. ':' .. chosenId)
end

return redis.call('HGETALL', jobHashPrefix .. chosenId)
