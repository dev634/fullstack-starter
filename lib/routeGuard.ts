// Pure path-matching rules for the proxy's auth gate + CLIENT->/portail
// boundary. Kept free of any Next.js/Auth.js import so it can be unit tested
// directly, without pulling in the Edge runtime that proxy.ts depends on.

// Same route set the auth-gate matcher covered before the CSP nonce was
// added in proxy.ts — kept as an explicit check (rather than narrowing
// config.matcher) because the matcher now has to run on every page for the
// nonce, but sign-in/reset/API routes must stay reachable while logged out.
const PROTECTED_PATHS = [
  /^\/$/,
  /^\/clients(\/.*)?$/,
  /^\/projects(\/.*)?$/,
  /^\/admin(\/.*)?$/,
  /^\/portail(\/.*)?$/,
  // Catches every future /api/** route handler by default (see PUBLIC_PATHS
  // below for the deliberate exceptions) — a handler added here without its
  // own auth check no longer stays open by accident.
  /^\/api(\/.*)?$/,
];

// Route handlers that must stay reachable without a session: the NextAuth
// endpoint itself (it IS the sign-in/callback flow) and the infra health
// check (no sensitive data — just `SELECT 1`).
const PUBLIC_PATHS = [/^\/api\/auth(\/.*)?$/, /^\/api\/health$/];

// Normalizes a pathname before it's matched against PROTECTED_PATHS, so the
// auth gate and the CLIENT->/portail boundary can't be slipped past by case
// (`/PORTAIL`), a doubled leading slash (`//admin`), or one level of percent
// encoding (`/portail%2f..`) that the regexes below wouldn't otherwise
// recognize as the real path. Malformed percent-encoding fails safe: the raw
// pathname is matched as-is rather than letting a decode error bypass the
// gate.
export function normalizePathname(pathname: string): string {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    decoded = pathname;
  }
  return decoded.toLowerCase().replace(/\/{2,}/g, "/");
}

export function isProtectedPath(pathname: string): boolean {
  const normalized = normalizePathname(pathname);
  if (PUBLIC_PATHS.some((re) => re.test(normalized))) return false;
  return PROTECTED_PATHS.some((re) => re.test(normalized));
}

export function isPortalPath(pathname: string): boolean {
  return /^\/portail(\/.*)?$/.test(normalizePathname(pathname));
}
