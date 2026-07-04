// Minimal in-memory, failure-based rate limiter. Suitable for a single
// instance (the VPS web container). For a multi-instance deployment this
// would need a shared store (Redis).

type Entry = { count: number; resetAt: number };

const store = new Map<string, Entry>();

export type RateLimitOptions = { limit: number; windowMs: number };

/** Is this key currently over its failure budget? */
export function isRateLimited(
  key: string,
  opts: RateLimitOptions,
  now: number = Date.now()
): { limited: boolean; retryAfterMs: number } {
  const entry = store.get(key);
  if (!entry || now >= entry.resetAt) {
    return { limited: false, retryAfterMs: 0 };
  }
  if (entry.count >= opts.limit) {
    return { limited: true, retryAfterMs: entry.resetAt - now };
  }
  return { limited: false, retryAfterMs: 0 };
}

/** Record a failed attempt, starting or extending the window. */
export function registerFailure(
  key: string,
  opts: RateLimitOptions,
  now: number = Date.now()
): void {
  const entry = store.get(key);
  if (!entry || now >= entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + opts.windowMs });
    return;
  }
  entry.count += 1;
}

/** Clear one key (e.g. on success) or the whole store (tests). */
export function clearRateLimit(key?: string): void {
  if (key) store.delete(key);
  else store.clear();
}
