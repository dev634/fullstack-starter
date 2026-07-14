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

// Higher rank outranks every role below it — SUPERADMIN can do anything an
// ADMIN can, so requireRole("ADMIN") also admits a SUPERADMIN session.
const ROLE_RANK = { SUPERADMIN: 3, ADMIN: 2, VIEWER: 1 } as const;

/**
 * Pure rank check, for page-level "show the edit UI" branching (session
 * already fetched, no need for the async requireRole). Use this instead of
 * `role === "ADMIN"` so a SUPERADMIN session is treated as ADMIN-or-above
 * everywhere, not just in server actions.
 */
export function hasMinRole(role: string | undefined, minRole: keyof typeof ROLE_RANK): boolean {
  return !!role && role in ROLE_RANK && ROLE_RANK[role as keyof typeof ROLE_RANK] >= ROLE_RANK[minRole];
}

/**
 * Guard mutations behind a minimum role (or higher). VIEWER accounts can
 * read but not create/edit/delete. On success, also returns the actor's
 * email for the activity log.
 */
export async function requireRole(minRole: keyof typeof ROLE_RANK): Promise<RoleCheckResult> {
  const session = await auth();
  const t = getDictionary(await getLocale());
  if (!session) {
    return { error: { type: "error", message: t.errors.unauthorized } };
  }
  if (!hasMinRole(session.user?.role, minRole)) {
    return { error: { type: "error", message: t.errors.forbidden } };
  }
  return { error: null, email: session.user?.email ?? "unknown" };
}
