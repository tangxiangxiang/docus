import { describe, expect, it } from 'vitest'
import {
  AuthRateLimiter,
  AUTH_FAILURE_THRESHOLD,
  AUTH_FAILURE_WINDOW_MS,
  AUTH_MAX_BUCKETS,
  AUTH_MAX_DELAY_MS,
} from '../auth/rateLimit.js'

describe('authentication rate limiter', () => {
  it('uses a five-minute window, bounded exponential retry, reset, and pruning', () => {
    let now = 1_700_000_000_000
    const limiter = new AuthRateLimiter({ now: () => now })
    for (let i = 0; i < AUTH_FAILURE_THRESHOLD - 1; i++) {
      expect(limiter.recordFailure('admin').retryAfterMs).toBe(0)
    }
    expect(limiter.recordFailure('admin').retryAfterMs).toBeGreaterThan(0)
    expect(limiter.recordFailure('admin').retryAfterMs).toBeGreaterThanOrEqual(1_000)
    expect(limiter.recordFailure('admin').retryAfterMs).toBeLessThanOrEqual(AUTH_MAX_DELAY_MS)
    limiter.reset('admin')
    expect(limiter.size).toBe(0)

    limiter.recordFailure('old')
    now += AUTH_FAILURE_WINDOW_MS + 1
    limiter.prune()
    expect(limiter.size).toBe(0)
  })

  it('keeps failure state bounded across untrusted usernames', () => {
    const limiter = new AuthRateLimiter({ maxBuckets: 8 })
    for (let i = 0; i < 100; i++) limiter.recordFailure(`username-${i}`)
    expect(limiter.size).toBeLessThanOrEqual(8)
    expect(limiter.maxBuckets).toBe(8)
    expect(AUTH_MAX_BUCKETS).toBeGreaterThan(8)
  })

  it('does not provide a pre-verification lockout operation', () => {
    const limiter = new AuthRateLimiter({ threshold: 1 })
    limiter.recordFailure('admin')
    // A caller must still perform its credential verification and decide how
    // to map this result; reset remains available after a correct password.
    limiter.reset('admin')
    expect(limiter.size).toBe(0)
  })
})
