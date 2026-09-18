import { auth } from "@/lib/auth";
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
