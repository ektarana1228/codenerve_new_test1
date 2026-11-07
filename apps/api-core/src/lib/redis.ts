import { Redis } from 'ioredis'

let _redis: Redis | undefined

export function getRedis(url: string): Redis {
  if (!_redis) {
    _redis = new Redis(url)
  }
  return _redis
}
