import z from "zod";

/**
 * Shared parsing for the `?folder=` query param both project-section
 * browsers use (Files and réserves — they each own the param on their own
 * route now, see reserves/page.tsx's own doc, but need the exact same
 * shape of value).
 *
 * Rejects anything that isn't a positive integer representable in the
 * `Int` (Postgres int4) columns `ProjectFolder.id` / `ReservePlanFolder.id`
 * actually are — the same bound `lib/assetDelivery.ts::assetIdSchema` uses
 * for the guarded asset route, and for the same reason: an unrepresentable
 * value (`?folder=99999999999999999999`, or the far more plausible
 * `?folder=2147483648`, one past the int4 ceiling) must never reach a
 * `WHERE parentId = …` the Postgres driver can't even encode — that crash
 * used to surface as "Unable to fit value … into a 64-bit signed integer"
 * all the way up to React's error boundary. Also folds Next's `string[]`
 * case (a repeated `?folder=1&folder=2`) down to its first value, same as
 * every other single-value query param this app reads.
 *
 * An invalid value resolves to `null` — the project root — rather than an
 * error: this param only ever changes which folder a browsing UI opens to,
 * so a garbled one is treated the same as an absent one instead of failing
 * the whole page.
 */
const folderIdSchema = z.coerce.number().int().positive().max(2_147_483_647);

export function parseFolderIdParam(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const parsed = folderIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
