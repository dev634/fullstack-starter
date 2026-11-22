/**
 * THE canonical form of a User e-mail: trimmed, lower-cased. Applied to every
 * write of `User.email` and every lookup of an account by e-mail (all of them
 * go through repository/users.ts), so that "Jean@X.fr" and "jean@x.fr" are one
 * account. Without it the lookup was exact-match while password reset alone
 * lower-cased — an account saved with capitals could never reset its password.
 * (A unique index on lower(email) is the database half, planned separately.)
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
