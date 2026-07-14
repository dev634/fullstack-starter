import { getRecentAttempts, recordAttempt, clearAttempts } from "@/repository/rateLimit";

// Persistent, Postgres-backed rate limiter (sliding window). Not an
// in-memory Map: Next.js can compile the same module into separate bundles
// for Server Actions vs Route Handlers, so in-process memory is not a
// reliable single source of truth across every call path — see
// repository/rateLimit.ts for the full reasoning.

export type RateLimitOptions = { limit: number; windowMs: number };

/** Is this key currently over its failure budget? */
export async function isRateLimited(
  key: string,
  opts: RateLimitOptions
): Promise<{ limited: boolean; retryAfterMs: number }> {
  const { count, oldestAt } = await getRecentAttempts(key, opts.windowMs);
  if (count >= opts.limit && oldestAt) {
    const retryAfterMs = Math.max(0, opts.windowMs - (Date.now() - oldestAt.getTime()));
    return { limited: true, retryAfterMs };
  }
  return { limited: false, retryAfterMs: 0 };
}

/** Record a failed attempt. */
export async function registerFailure(key: string): Promise<void> {
  await recordAttempt(key);
}

/** Clear every recorded attempt for a key (e.g. on success). */
export async function clearRateLimit(key: string): Promise<void> {
  await clearAttempts(key);
}
