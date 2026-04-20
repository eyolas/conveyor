-- Promote delayed jobs whose score is <= ARGV[1] into the waiting list.
--
-- KEYS[1] = delayed ZSET
-- KEYS[2] = waiting list
-- ARGV[1] = upper-bound score as a string ("+inf" promotes every delayed job)
-- ARGV[2] = job hash prefix, e.g. "{conveyor:q}:job:"
--          Constructed so hash touches stay on the same cluster slot as KEYS
--          (the caller's key prefix already encodes the queue hash tag).
--
-- Returns the number of promoted ids.
local ids = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if #ids == 0 then
  return 0
end
for _, id in ipairs(ids) do
  redis.call('ZREM', KEYS[1], id)
  redis.call('RPUSH', KEYS[2], id)
  redis.call('HSET', ARGV[2] .. id, 'state', 'waiting')
  redis.call('HDEL', ARGV[2] .. id, 'delayUntil')
end
return #ids
