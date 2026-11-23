/**
 * THE canonical form of a User e-mail: trimmed, lower-cased. Applied to every
 * write of `User.email` and every lookup of an account by e-mail (all of them
 * go through repository/users.ts), so that "Jean@X.fr" and "jean@x.fr" are one
 * account. Without it the lookup was exact-match while password reset alone
 * lower-cased — an account saved with capitals could never reset its password.
 * (A unique index on lower(email) is the database half, planned separately.)
 *
 * Lower-casing the LOCAL part too is a decision, not a fact of the standard:
 * RFC 5321 says the local part is case-sensitive. In practice no mainstream
 * provider treats "Jean@" and "jean@" as two mailboxes, and keeping them apart
 * would let two accounts coexist for what a person types as one address. The
 * price — an address that really is case-sensitive cannot be told apart — is
 * accepted. Rows saved before this existed may still hold capitals: lookups are
 * exact on the canonical form (a case-insensitive match would be an unescaped
 * ILIKE, see repository/users.ts::sessionAccountWhere), so such rows will be
 * normalized by the lot 3 migration (20261123100000_user_session_version_and_email_ci);
 * until it is applied they are not matched.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
