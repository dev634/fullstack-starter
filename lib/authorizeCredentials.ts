import { verifyCredentials } from "@/service/auth";
import { isLoginRateLimited, registerLoginFailure, clearLoginRateLimit } from "@/lib/loginRateLimit";

/** Best-effort client IP from the proxy's forwarded headers. */
function clientIpFrom(request: Request | undefined): string {
  const h = request?.headers;
  return h?.get("x-forwarded-for")?.split(",")[0]?.trim() || h?.get("x-real-ip") || "unknown";
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

  const user = await verifyCredentials({
    email,
    password: String(credentials?.password ?? ""),
  });

  if (!user) {
    registerLoginFailure(email, ip);
    return null;
  }

  clearLoginRateLimit(email);
  return user;
}
