import { auth } from "@/lib/auth";

/**
 * Guard actions behind an authenticated session. Returns an error payload
 * when there is no session, or `null` when the caller may proceed. Server
 * actions are callable directly, so page-level middleware isn't enough.
 */
export async function requireSession(): Promise<{ type: "error"; message: string } | null> {
  const session = await auth();
  if (!session) {
    return { type: "error", message: "Unauthorized. Please sign in." };
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
  if (!session) {
    return { error: { type: "error", message: "Unauthorized. Please sign in." } };
  }
  if (session.user?.role !== role) {
    return { error: { type: "error", message: "Forbidden. Your role does not allow this action." } };
  }
  return { error: null, email: session.user?.email ?? "unknown" };
}
