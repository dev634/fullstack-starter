import { auth } from "@/lib/auth";

/**
 * Authorization for route handlers (`app/**\/route.ts`).
 *
 * Pages get this for free: the proxy gates them, and `blockClientFromApp()`
 * adds a second check inside the render. Route handlers had neither — they
 * relied on the proxy alone, which is a single point of failure for the most
 * sensitive surface in the app (the CSV exports stream the entire client and
 * contact tables). That single layer has already failed once here: the portal
 * boundary silently opened when `req.auth.user.role` came back undefined
 * because the session callbacks weren't visible to the edge proxy. Middleware
 * bypasses are also a recurring Next.js CVE class.
 *
 * So handlers check again, in the Node runtime, where the session is fully
 * resolved.
 *
 * Kept out of lib/routeGuard.ts on purpose: this imports lib/auth.ts, which
 * pulls in Node-only dependencies (bcrypt) through the credentials provider.
 * routeGuard.ts's path-matching functions are imported by proxy.ts, which
 * runs on the Edge runtime — bundling a Node-only import into that module
 * graph risks breaking the Edge build even though proxy.ts never calls this
 * function.
 */

export type GuardResult<T> = { ok: true; value: T } | { ok: false; response: Response };

/**
 * Require an authenticated app user. CLIENT (portal) logins are refused: they
 * live behind `/portail`, which is scoped per project, and none of the app
 * routes apply that scoping.
 */
export async function requireAppUser(): Promise<GuardResult<{ email: string; role: string }>> {
  const session = await auth();

  if (!session?.user) {
    return { ok: false, response: new Response("Unauthorized", { status: 401 }) };
  }
  if (session.user.role === "CLIENT") {
    return { ok: false, response: new Response("Forbidden", { status: 403 }) };
  }

  return {
    ok: true,
    value: { email: session.user.email ?? "", role: session.user.role ?? "" },
  };
}
