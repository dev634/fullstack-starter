import { auth } from "@/lib/auth";
import { hasMinRole } from "@/lib/authz";
import { findIdByEmail } from "@/repository/users";

/**
 * The current session's real database user id.
 *
 * The session itself only ever carries `{email, role}` (lib/auth.ts,
 * lib/requireAppUser.ts) — never a numeric id — so every mutation that needs
 * to know "which row IS the caller" (an equipment's owner, a loan's
 * borrower) must resolve it here, in the database, rather than trust an id
 * a form could submit. Returns `null` when there is no session, or the
 * session's email no longer matches a user (deleted account, stale cookie).
 */
export async function getCurrentUserId(): Promise<number | null> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;
  return await findIdByEmail(email);
}

export type LoansActor = { userId: number; isAdmin: boolean };

/**
 * The "owner or admin" authority check the Prêts rubrique repeats on every
 * mutation (and its own page): one session lookup instead of the
 * `auth()` + `hasMinRole(...)` + `getCurrentUserId()` trio copied 7 times
 * across actions/equipment, actions/equipmentLoans and app/loans/page.tsx.
 * Returns `null` under the exact same condition as getCurrentUserId — no
 * session, or its email no longer matches a user.
 */
export async function getLoansActor(): Promise<LoansActor | null> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;
  const userId = await findIdByEmail(email);
  if (userId === null) return null;
  return { userId, isAdmin: hasMinRole(session.user?.role, "ADMIN") };
}
