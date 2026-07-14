import { isRateLimited, registerFailure, clearRateLimit } from "@/lib/rate-limit";

// Per-email (targeted) and per-IP (spray) caps for credential sign-in.
// Shared between the custom `login` server action (fast-fail UX message)
// and Auth.js's `authorize()` callback (the actual enforcement point —
// see lib/auth.ts for why enforcement can't live in the action alone).
const LOGIN_LIMIT = { limit: 5, windowMs: 15 * 60 * 1000 };
const LOGIN_IP_LIMIT = { limit: 20, windowMs: 15 * 60 * 1000 };

function keysFor(email: string, ip: string) {
  return { emailKey: `login:${email.toLowerCase()}`, ipKey: `login-ip:${ip}` };
}

/** Read-only check — safe to call speculatively for a fast-fail UX message. */
export function isLoginRateLimited(email: string, ip: string): { limited: boolean; retryAfterMs: number } {
  const { emailKey, ipKey } = keysFor(email, ip);
  const rl = isRateLimited(emailKey, LOGIN_LIMIT);
  const rlIp = isRateLimited(ipKey, LOGIN_IP_LIMIT);
  return { limited: rl.limited || rlIp.limited, retryAfterMs: Math.max(rl.retryAfterMs, rlIp.retryAfterMs) };
}

/** Record a failed attempt. Call exactly once per failure — from authorize(), the single choke point every sign-in path funnels through. */
export function registerLoginFailure(email: string, ip: string): void {
  const { emailKey, ipKey } = keysFor(email, ip);
  registerFailure(emailKey, LOGIN_LIMIT);
  registerFailure(ipKey, LOGIN_IP_LIMIT);
}

export function clearLoginRateLimit(email: string): void {
  clearRateLimit(`login:${email.toLowerCase()}`);
}
