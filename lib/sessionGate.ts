import { cache } from "react";
import { findSessionAccount } from "@/repository/users";

/**
 * Closes a gap the JWT session strategy otherwise leaves wide open: next-auth
 * re-signs the session cookie with a fresh 30-day expiry on every request
 * that uses it (handleAuth → the session actions re-encode the token), so it
 * never naturally expires on its own. Nothing else re-reads the account it
 * claims to be. Delete that account — an admin removing a departing EDITOR,
 * say — and its last-issued cookie keeps authenticating as that (now
 * nonexistent) row forever, with whatever role it last carried, for as long
 * as the browser holds onto it.
 *
 * lib/auth.ts's `jwt` callback calls keepLiveSessionToken on every pass
 * EXCEPT a fresh sign-in (the row was just read and the password just
 * verified there) and hands back whatever this returns: the token unchanged
 * to keep the session alive, or `null` to void it — next-auth's `jwt`
 * callback returning `null` makes `auth()` resolve to no session at all from
 * that request on. `lib/accessContext.ts` then treats "no session" as
 * DENIED, not "unrestricted".
 *
 * This runs in Node only (no import of next-auth itself) — kept separate
 * from lib/auth.ts so it stays trivially unit-testable without constructing
 * the full NextAuth() instance, the same reason lib/authorizeCredentials.ts
 * is its own module.
 */

/**
 * `cache` (react) deduplicates the lookup per RSC render — `auth()` is
 * called roughly a dozen times rendering a single page — without caching
 * ACROSS requests: a different request always re-reads the row, so a delete
 * is visible on the very next request, not merely "eventually". Calling this
 * outside a render (a plain Node script, a test) just skips the
 * memoization and stays correct — `cache` is documented to pass through
 * uncached when there is no request-scoped cache to attach to.
 */
const findLiveSessionAccount = cache(async (id: number, email: string) => {
  return await findSessionAccount(id, email);
});

/**
 * `sub` must be the decimal text of a positive safe integer — anything this
 * gate cannot parse (absent, `"1.5"`, `"-3"`, a non-numeric string) is
 * refused outright, without a database round trip: a value it doesn't
 * understand must void the session, never fall back to treating it as valid.
 */
function parseSessionId(sub: string | undefined): number | null {
  if (!sub || !/^[0-9]+$/.test(sub)) return null;
  const id = Number(sub);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * The token unchanged if its account still exists, `null` otherwise.
 *
 * The id AND the email are checked together (never the id alone): ids are
 * never reused, so an account deleted and then recreated under the SAME
 * email gets a NEW id. A stale cookie carrying the OLD id must not resolve
 * to the new row and inherit whatever role that new account was just given.
 */
export async function keepLiveSessionToken<T extends { sub?: string; email?: string | null }>(
  token: T
): Promise<T | null> {
  const id = parseSessionId(token.sub);
  if (id === null) return null;
  const email = token.email;
  if (!email) return null;

  const account = await findLiveSessionAccount(id, email);
  return account ? token : null;
}
