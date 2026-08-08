import { headers } from "next/headers";

/**
 * Extracts the best-effort client IP from a Headers-like object's
 * X-Forwarded-For / X-Real-Ip.
 *
 * Takes the LAST entry in X-Forwarded-For, not the first: our reverse proxy
 * (see docs/deploy-hostinger.md) appends the real peer IP via
 * $proxy_add_x_forwarded_for rather than replacing the header, so any
 * client-supplied X-Forwarded-For value ends up as a spoofable *prefix* and
 * only the last hop was actually set by our trusted proxy.
 */
function ipFromHeaders(h: Pick<Headers, "get">): string {
    const forwarded = h.get("x-forwarded-for");
    const lastHop = forwarded?.split(",").pop()?.trim();
    return lastHop || h.get("x-real-ip") || "unknown";
}

/**
 * Best-effort client IP for a Server Action / Route Handler, read from the
 * current request's headers via next/headers. Single source for what used
 * to be three near-identical copies of this same extraction (this project's
 * "beyond two, extract" DRY threshold) — actions/auth/auth.ts,
 * lib/authorizeCredentials.ts, and actions/deliveryNoteScan/deliveryNoteScan.ts.
 */
export async function getClientIp(): Promise<string> {
    const h = await headers();
    return ipFromHeaders(h);
}

/**
 * Same extraction, from an explicit Request rather than next/headers — for
 * call sites outside the Server Action / Route Handler request scope, e.g.
 * NextAuth's `authorize()` callback (lib/authorizeCredentials.ts), which
 * receives its own Request and can't rely on next/headers' AsyncLocalStorage
 * being populated.
 */
export function clientIpFromRequest(request: Request | undefined): string {
    if (!request) return "unknown";
    return ipFromHeaders(request.headers);
}
