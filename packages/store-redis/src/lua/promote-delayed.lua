-- Promote delayed jobs whose score is <= ARGV[1] into the waiting list.
--
-- KEYS[1] = delayed ZSET
-- KEYS[2] = waiting list
-- ARGV[1] = upper-bound score as a string ("+inf" promotes every delayed job)
-- ARGV[2] = job hash prefix,      e.g. "{conveyor:q}:job:"
-- ARGV[3] = group prefix,         e.g. "{conveyor:q}:group:"
-- ARGV[4] = group waiting suffix, e.g. ":waiting"
-- ARGV[5] = now (ms) — score used for the group-waiting ZSET entry
--
-- Returns the number of promoted ids. Keys that a script touches dynamically
-- must share the hash tag of the declared KEYS; the same `{conveyor:queue}`
-- tag used by KEYS[1]/KEYS[2] covers every group-waiting key this script
-- adds to, so we stay cluster-safe without declaring them as KEYS.
local ids = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if #ids == 0 then
  return 0
end
local jobPrefix          = ARGV[2]
local groupPrefix        = ARGV[3]
local groupWaitingSuffix = ARGV[4]
local now                = ARGV[5]
for _, id in ipairs(ids) do
  redis.call('ZREM', KEYS[1], id)
  redis.call('RPUSH', KEYS[2], id)
  local jobKey = jobPrefix .. id
  local gid = redis.call('HGET', jobKey, 'groupId')
  redis.call('HSET', jobKey, 'state', 'waiting')
  redis.call('HDEL', jobKey, 'delayUntil')
  if type(gid) == 'string' and gid ~= '' then
    redis.call('ZADD', groupPrefix .. gid .. groupWaitingSuffix, now, id)
  end
end
return #ids
