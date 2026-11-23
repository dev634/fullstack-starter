import { cache } from "react";
import { findSessionAccount } from "@/repository/users";

/**
 * Closes two gaps the JWT session strategy otherwise leaves wide open. Next-auth
 * re-signs the session cookie with a fresh 30-day expiry on every request that
 * uses it (handleAuth → the session actions re-encode the token), so it never
 * naturally expires; and the token is a SNAPSHOT of the account taken at
 * sign-in (its role, its sessionVersion), which nothing refreshes.
 *
 *   1. The account is gone. Delete it — an admin removing a departing EDITOR,
 *      say — and, before this gate, its last-issued cookie kept authenticating
 *      as that (now nonexistent) row forever, with whatever role it last
 *      carried: the one lookup that did read the row on each request
 *      (getAccessContext's findAccessScopeByEmail) read its absence as "no
 *      restriction".
 *   2. The account CHANGED under the cookie. A role lowered from ADMIN to
 *      VIEWER left the cookie authenticating as ADMIN (the guards read
 *      `session.user.role`, which comes from the token); a password changed
 *      after a leak left the stolen cookie valid.
 *
 * What voids a token, all read from the row on every pass:
 *   - the account does not exist (or its id/email pair no longer matches);
 *   - `User.sessionVersion` differs from the token's. The counter is bumped, in
 *     the same statement as the write, by every writer of the password
 *     (repository/users.ts::updateProfile and ::resetPasswordWithToken — checked by
 *     tests/account-writers-coverage.test.ts, within the limits stated on its
 *     helper's `userWriteSites`: a client not named `prisma`/`tx`, raw SQL and
 *     an opaque spread are not seen, and the CONDITION of the bump is judged
 *     only by tests-integration/session-version-bump.test.ts);
 *   - `User.role` differs from the token's. This one covers EVERY writer of the
 *     role by construction — a SQL script included — without relying on that
 *     writer remembering to bump.
 * An ABSENT token version reads as 0: those are the cookies issued before the
 * column existed, and the database is at 0 everywhere, so they live until the
 * first change. A version that is PRESENT but is not a safe integer >= 0
 * (`"1"`, `-1`, `1.5`, `NaN`, `null`) is refused: a value this gate does not
 * understand voids the session, it is never normalized to the neutral 0.
 *
 * What does NOT void a token: signing out. `logout` (actions/auth/auth.ts) only
 * clears the browser's cookie — there is no server-side session to destroy, and
 * the counter is not bumped, because that would sign every device of the
 * account out (a product decision not taken). A cookie stolen BEFORE a logout
 * stays valid until the next password or role change of its account. Nor does a
 * change of name or of job function: the function is re-read from the row on
 * every request, it is not in the token.
 *
 * Two layers refuse, and they cover different moments — do not read one as a
 * duplicate of the other:
 *   - THIS gate, on the token, at the root. An account deleted or changed
 *     BETWEEN two requests is caught by the next one: each request re-reads the
 *     row (the memoization below is per render, never across requests), the
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
 * verified there; auth.config.ts stamps the role and the version on the token
 * at that moment, and only then) and hands back whatever this returns: the
 * token unchanged to keep the session alive, or `null` to void it — next-auth's
 * `jwt` callback returning `null` makes `auth()` resolve to no session at all
 * from that request on. `lib/accessContext.ts` then treats "no session" as
 * DENIED, not "unrestricted".
 *
 * An admin who changes their OWN password (or role) through the account
 * management screen voids their own session on the next request: back to
 * /login. Accepted.
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
const findLiveSessionAccount = cache(findSessionAccount);

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
 * The token's session version: absent = 0 (a cookie issued before the column
 * existed), a safe integer >= 0 = itself, anything else = null (refused).
 */
function parseTokenVersion(version: unknown): number | null {
  if (version === undefined) return 0;
  return typeof version === "number" && Number.isSafeInteger(version) && version >= 0 ? version : null;
}

/**
 * The token unchanged if its account still exists AND is still the account the
 * token was issued for (same sessionVersion, same role), `null` otherwise — and
 * a THROW if the lookup itself fails (database down): `findSessionAccount`
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
export async function keepLiveSessionToken<
  T extends { sub?: string; email?: string | null; role?: unknown; sessionVersion?: unknown },
>(token: T): Promise<T | null> {
  const id = parseSessionId(token.sub);
  if (id === null) return null;
  const email = token.email;
  if (!email) return null;
  const tokenVersion = parseTokenVersion(token.sessionVersion);
  if (tokenVersion === null) return null;

  const account = await findLiveSessionAccount(id, email);
  if (!account) return null;
  if (account.sessionVersion !== tokenVersion) return null;
  if (account.role !== token.role) return null;
  return token;
}
