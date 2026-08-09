export const AUTH_FAILURE_WINDOW_MS = 5 * 60 * 1000
export const AUTH_FAILURE_THRESHOLD = 5
export const AUTH_MAX_DELAY_MS = 15 * 60 * 1000
export const AUTH_MAX_BUCKETS = 256
export const AUTH_BASE_RETRY_MS = 1_000
export const SETUP_FAILURE_WINDOW_MS = 60 * 1000
export const SETUP_FAILURE_THRESHOLD = 3
export const SETUP_MAX_BUCKETS = 64

export type RateLimiterOptions = {
  readonly windowMs?: number
  readonly threshold?: number
  readonly maxDelayMs?: number
  readonly maxBuckets?: number
  readonly baseRetryMs?: number
  readonly now?: () => number
}

export type FailureRecord = {
  readonly failures: number
  readonly retryAfterMs: number
}

type Bucket = {
  failures: number
  firstFailureAt: number
  lastFailureAt: number
}

function positiveInteger(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`)
  return value
}

/**
 * Bounded, restart-reset failure accounting for authentication attempts.
 * This limiter deliberately does not pre-reject a request: callers must
 * verify credentials first so a hot bucket cannot lock the only owner out.
 */
export class AuthRateLimiter {
  readonly windowMs: number
  readonly threshold: number
  readonly maxDelayMs: number
  readonly maxBuckets: number
  readonly baseRetryMs: number

  private readonly now: () => number
  private readonly buckets = new Map<string, Bucket>()

  constructor(options: RateLimiterOptions = {}) {
    this.windowMs = positiveInteger('windowMs', options.windowMs ?? AUTH_FAILURE_WINDOW_MS)
    this.threshold = positiveInteger('threshold', options.threshold ?? AUTH_FAILURE_THRESHOLD)
    this.maxDelayMs = positiveInteger('maxDelayMs', options.maxDelayMs ?? AUTH_MAX_DELAY_MS)
    this.maxBuckets = positiveInteger('maxBuckets', options.maxBuckets ?? AUTH_MAX_BUCKETS)
    this.baseRetryMs = positiveInteger('baseRetryMs', options.baseRetryMs ?? AUTH_BASE_RETRY_MS)
    this.now = options.now ?? Date.now
  }

  get size(): number {
    return this.buckets.size
  }

  recordFailure(key: string, at = this.now()): FailureRecord {
    this.prune(at)
    const normalizedKey = typeof key === 'string' && key.length > 0 ? key : '<invalid>'
    let bucket = this.buckets.get(normalizedKey)
    if (!bucket || at - bucket.firstFailureAt >= this.windowMs) {
      bucket = { failures: 0, firstFailureAt: at, lastFailureAt: at }
      this.buckets.set(normalizedKey, bucket)
    }
    bucket.failures += 1
    bucket.lastFailureAt = at
    this.enforceBound(at)

    const exponent = Math.max(0, bucket.failures - this.threshold)
    const retryAfterMs = bucket.failures >= this.threshold
      ? Math.min(this.maxDelayMs, this.baseRetryMs * 2 ** exponent)
      : 0
    return { failures: bucket.failures, retryAfterMs }
  }

  reset(key: string): void {
    this.buckets.delete(key)
  }

  prune(at = this.now()): void {
    for (const [key, bucket] of this.buckets) {
      if (at - bucket.lastFailureAt >= this.windowMs) this.buckets.delete(key)
    }
  }

  private enforceBound(at: number): void {
    while (this.buckets.size > this.maxBuckets) {
      let oldestKey: string | undefined
      let oldestAt = Number.POSITIVE_INFINITY
      for (const [key, bucket] of this.buckets) {
        if (bucket.lastFailureAt < oldestAt) {
          oldestKey = key
          oldestAt = bucket.lastFailureAt
        }
      }
      if (oldestKey === undefined) break
      this.buckets.delete(oldestKey)
    }
    // Keep a deterministic cleanup point even when a caller records failures
    // with a synthetic clock that moves backwards.
    if (!Number.isFinite(at)) this.prune(Date.now())
  }
}

export const createAuthRateLimiter = (options?: RateLimiterOptions): AuthRateLimiter =>
  new AuthRateLimiter(options)
