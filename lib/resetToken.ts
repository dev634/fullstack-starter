import { createHash } from "crypto";

/**
 * Hash a password-reset token for storage.
 *
 * The token in the emailed link is high-entropy random (32 bytes), so it needs
 * no slow/salted hash the way a password does — it can't be guessed. But it
 * must not be stored verbatim: a reset token grants account takeover, so anyone
 * who can read the table (a SQL-injection read, a leaked backup, an insider)
 * would otherwise hold live tokens. We store only the SHA-256, and look rows up
 * by hashing the incoming token — the plaintext exists only in the user's URL.
 */
export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
