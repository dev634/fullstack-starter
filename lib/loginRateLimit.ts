import { isRateLimited, registerFailure, clearRateLimit } from "@/lib/rate-limit";
import { normalizeEmail } from "@/lib/normalizeEmail";

// Per-email (targeted) and per-IP (spray) caps for credential sign-in.
// Shared between the custom `login` server action (fast-fail UX message)
// and Auth.js's `authorize()` callback (the actual enforcement point —
// see lib/auth.ts for why enforcement can't live in the action alone).
const LOGIN_LIMIT = { limit: 5, windowMs: 15 * 60 * 1000 };
const LOGIN_IP_LIMIT = { limit: 20, windowMs: 15 * 60 * 1000 };

// The e-mail is keyed in its canonical form (lib/normalizeEmail.ts), the one
// the account lookup matches: "Jean@X.fr " and "jean@x.fr" are ONE account, so
// they share ONE attempt budget (a trailing space or a capital must not buy a
// fresh set of guesses).
function emailKey(email: string) {
  return `login:${normalizeEmail(email)}`;
}

function keysFor(email: string, ip: string) {
  return { emailKey: emailKey(email), ipKey: `login-ip:${ip}` };
}

/** Read-only check — safe to call speculatively for a fast-fail UX message. */
export async function isLoginRateLimited(email: string, ip: string): Promise<{ limited: boolean; retryAfterMs: number }> {
  const { emailKey, ipKey } = keysFor(email, ip);
  const [rl, rlIp] = await Promise.all([
    isRateLimited(emailKey, LOGIN_LIMIT),
    isRateLimited(ipKey, LOGIN_IP_LIMIT),
  ]);
  return { limited: rl.limited || rlIp.limited, retryAfterMs: Math.max(rl.retryAfterMs, rlIp.retryAfterMs) };
}

/** Record a failed attempt. Call exactly once per failure — from authorize(), the single choke point every sign-in path funnels through. */
export async function registerLoginFailure(email: string, ip: string): Promise<void> {
  const { emailKey, ipKey } = keysFor(email, ip);
  await Promise.all([registerFailure(emailKey), registerFailure(ipKey)]);
}

export async function clearLoginRateLimit(email: string): Promise<void> {
  await clearRateLimit(emailKey(email));
}
