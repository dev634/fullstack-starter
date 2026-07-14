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

  if (isLoginRateLimited(email, ip).limited) {
    return null;
  }

  // Reserve this attempt against the budget now, synchronously and before
  // the slow bcrypt compare below (verifyCredentials awaits it). Node runs
  // this whole synchronous block to completion before yielding to any other
  // request, so this closes the race where a burst of concurrent requests
  // could all pass the check above before any of them had registered —
  // letting far more than 5 guesses through while bcrypt was still pending.
  registerLoginFailure(email, ip);

  const user = await verifyCredentials({
    email,
    password: String(credentials?.password ?? ""),
  });

  if (!user) {
    return null;
  }

  clearLoginRateLimit(email);
  return user;
}
