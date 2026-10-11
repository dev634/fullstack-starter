import { cache } from "react";
import { findSessionAccount } from "@/repository/users";

/**
 * Closes a gap the JWT session strategy otherwise leaves wide open: next-auth
 * re-signs the session cookie with a fresh 30-day expiry on every request
 * that uses it (handleAuth → the session actions re-encode the token), so it
 * never naturally expires on its own, and the token carries nothing that
 * tells it its account is gone. Delete that account — an admin removing a
 * departing EDITOR, say — and, before this gate, its last-issued cookie kept
 * authenticating as that (now nonexistent) row forever, with whatever role
 * it last carried, for as long as the browser held onto it: the one lookup
 * that did read the row on each request (getAccessContext's
 * findAccessScopeByEmail) read its absence as "no restriction".
 *
 * Two layers refuse now, and they cover different moments — do not read one
 * as a duplicate of the other:
 *   - THIS gate, on the token, at the root. An account deleted BETWEEN two
 *     requests is caught by the next one: each request re-reads the row
 *     (the memoization below is per render, never across requests), the
 *     token is voided, and every reader sees no session at all.
 *   - The readers' own refusals (getAccessContext → DENIED, getCurrentUserId
 *     → null, …, all resolving the row through
 *     repository/users.ts::sessionAccountWhere). They are what catches an
 *     account deleted DURING a request: after this gate passed the token
 *     (its verdict is memoized for the render) and before the reader's own
 *     query ran. That is the one window the gate cannot close.
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
 * The token unchanged if its account still exists, `null` otherwise — and a
 * THROW if the lookup itself fails (database down): `findSessionAccount`
 * rejects and this function lets it through, so a session is never kept on an
 * answer nobody gave.
 *
 * The id AND the email are checked together (never the id alone): ids are
 * never reused, so an account deleted and then recreated under the SAME
 * email gets a NEW id. A stale cookie carrying the OLD id must not resolve
 * to the new row and inherit whatever role that new account was just given.
 *
 * During a database outage, what happens (checked by running the real
 * NextAuth() and lib/auth.ts with only this lookup made to fail, next-auth
 * 5.0.0-beta.32 — not inferred from the code):
 *   - Auth.js catches the throw inside its own session handler, so `auth()`
 *     never throws: it logs and resolves to `null`, exactly as for a voided
 *     token. Pages therefore land on /login (blockClientFromApp redirects an
 *     absent session there; a page whose first guard is another one gets
 *     there through /acces-refuse or /clients), actions answer "unauthorized",
 *     routes answer 401, and getAccessContext is DENIED.
 *   - The journal gets one `[auth][error] JWTSessionError` line per `auth()`
 *     call. It carries no cause: what is thrown is the repository's plain
 *     `{ type, message }` object, not an Error, so Auth.js has nothing to
 *     unwrap. The line that names the database is the repository's own
 *     `Repository findSessionAccount error:`.
 *   - The browser's cookie is left alone: a server-side `auth()` takes the
 *     session response's body and drops its Set-Cookie, and `auth()` calls
 *     `cookies()` zero times. Everyone is back as soon as the database is.
 *
 * Signing everyone out for the length of an outage is the price of failing
 * closed. The alternative — keep the token when the lookup cannot answer —
 * fails open: every deleted account's cookie would be good again at this
 * layer for as long as the outage lasts.
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
