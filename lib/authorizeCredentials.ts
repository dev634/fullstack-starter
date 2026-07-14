import { verifyCredentials } from "@/service/auth";
import { isLoginRateLimited, registerLoginFailure, clearLoginRateLimit } from "@/lib/loginRateLimit";

/**
 * Best-effort client IP from the proxy's forwarded headers.
 * Takes the LAST entry in X-Forwarded-For, not the first: our nginx config
 * (docs/deploy-hostinger.md) appends the real peer IP via
 * $proxy_add_x_forwarded_for rather than replacing the header, so any
 * client-supplied X-Forwarded-For value ends up as a spoofable *prefix* and
 * only the last hop was actually set by our trusted proxy.
 */
function clientIpFrom(request: Request | undefined): string {
  const h = request?.headers;
  const forwarded = h?.get("x-forwarded-for");
  const lastHop = forwarded?.split(",").pop()?.trim();
  return lastHop || h?.get("x-real-ip") || "unknown";
}

// This is the ONE place every credentials sign-in funnels through — both the
// custom `login` server action (actions/auth/auth.ts) and Auth.js's own
// /api/auth/callback/credentials endpoint, which is always mounted and
// directly POST-able, bypassing any rate-limit check that lived only in the
// action. Enforcing it here closes that hole regardless of which path a
// caller uses. Kept in its own module (rather than inlined in lib/auth.ts)
// so it can be unit-tested without constructing the full NextAuth() instance.
export async function authorizeCredentials(
  credentials: Partial<Record<"email" | "password", unknown>>,
  request?: Request
) {
  const email = String(credentials?.email ?? "");
  const ip = clientIpFrom(request);

  // Reserve this attempt FIRST, before even checking the budget — the check
  // and the reservation are two separate DB round trips (a SELECT count and
  // an INSERT), so checking first would reopen the exact race this closes:
  // a burst of concurrent requests could all see "under budget" before any
  // of them had recorded, letting far more than 5 guesses through while
  // their bcrypt compares were still pending. Recording unconditionally
  // first means every attempt is durably counted the moment it arrives,
  // regardless of how many siblings are in flight at the same instant.
  await registerLoginFailure(email, ip);

  if ((await isLoginRateLimited(email, ip)).limited) {
    return null;
  }

  const user = await verifyCredentials({
    email,
    password: String(credentials?.password ?? ""),
  });

  if (!user) {
    return null;
  }

  await clearLoginRateLimit(email);
  return user;
}
