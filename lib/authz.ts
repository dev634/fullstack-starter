import { auth } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";

/**
 * Guard actions behind an authenticated session. Returns an error payload
 * when there is no session, or `null` when the caller may proceed. Server
 * actions are callable directly, so page-level middleware isn't enough.
 */
export async function requireSession(): Promise<{ type: "error"; message: string } | null> {
  const session = await auth();
  if (!session) {
    const t = getDictionary(await getLocale());
    return { type: "error", message: t.errors.unauthorized };
  }
  return null;
}

export type RoleCheckResult =
  | { error: { type: "error"; message: string }; email?: undefined }
  | { error: null; email: string };

/**
 * Guard mutations behind a minimum role. VIEWER accounts can read but not
 * create/edit/delete. On success, also returns the actor's email for the
 * activity log.
 */
export async function requireRole(role: "ADMIN"): Promise<RoleCheckResult> {
  const session = await auth();
  const t = getDictionary(await getLocale());
  if (!session) {
    return { error: { type: "error", message: t.errors.unauthorized } };
  }
  if (session.user?.role !== role) {
    return { error: { type: "error", message: t.errors.forbidden } };
  }
  return { error: null, email: session.user?.email ?? "unknown" };
}
