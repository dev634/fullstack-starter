import z from "zod";

// Shared free-text length ceilings (adversarial pass 2, point 5): before
// this, only appSettings.appName (60), jobFunction.name (80), user.name
// (120) and the delivery-scan strings (200, schemas/deliveryNoteScan.ts)
// were bounded — every other z.string().min(1) in the app had no upper
// bound at all. Proven reachable: a 100 000-character companyName, a
// 500 000-character Reserve.description, and a task series whose `pattern`
// (itself unbounded, though MAX_SERIES_SIZE already caps the row COUNT)
// amplified a 200 KB request into ~40 MB actually written to the database
// (200 generated rows × a 200 001-character title each).
//
// One named tier per USAGE rather than one number per field, so a name-like
// field and a description-like field can't drift to arbitrary, inconsistent
// numbers across schemas that describe the same kind of thing — a company
// name isn't a description. Every ceiling here is picked generous enough
// that no legitimate entry is ever close to it.
export const MAX_NAME_LENGTH = 200; // a person/company/project/task/category/folder name or title
export const MAX_LINE_LENGTH = 300; // a single structured line with more headroom than a name: a street address
export const MAX_REFERENCE_LENGTH = 200; // a supplier product reference — must match the delivery-note scan ceiling, which writes it straight to the database
export const MAX_CODE_LENGTH = 40; // a short structured code: a postal code, a business/reference number
export const MAX_NOTE_LENGTH = 5000; // free-form prose: a description, project notes
export const MAX_EMAIL_LENGTH = 254; // RFC 5321's practical mailbox length limit
export const MAX_URL_LENGTH = 2048; // common browser/URL-bar length ceiling
// 30 was a defect, not a tier, and 60 was another: this constant's own former
// comment described "an international number with formatting (spaces, +,
// extension)" as the use case, but the ordinary shapes of that do not fit.
// Counted character by character (spaces included):
//   - 31: "+33 (0)1 23 45 67 89 poste 1234" and "01 23 45 67 89 / 06 12 34 56 78"
//   - 55: "+33 1 23 45 67 89 (bureau) / +33 6 12 34 56 78 (mobile)"
//   - 63: "+33 (0)1 23 45 67 89 poste 1234 / +33 (0)6 12 34 56 78 (mobile)"
//   - 65: "+33 (0)1 23 45 67 89 poste 1234 / +33 (0)6 12 34 56 78 poste 5678"
//   - 72: "+33 (0)1 23 45 67 89 poste 1234 (bureau) / +33 (0)6 12 34 56 78 (mobile)"
// A 60 ceiling refused the last three — a company/contact record carrying
// office + mobile could not be re-saved at all. 80 sits above the longest
// counted example (72) with a margin, rather than at a round number. Measured
// in production: no stored phone exceeds 10 characters, and no SQL CHECK
// bounds these columns, so raising the ceiling invalidates no existing row.
// tests/phone-max-length.test.ts runs every example above through the schemas.
export const MAX_PHONE_LENGTH = 80; // one formatted international number with an extension, or two numbers separated by " / " — see the counted examples above

/**
 * A positive integer id coming from a <select> (or CSV import), or null when
 * "none" ("") is explicitly chosen. Optional so the field may be absent from
 * the payload entirely. The generic shape behind optionalJobFunctionId below —
 * extracted rather than re-written a second time for
 * ProjectMaterial.materialCategoryId (schemas/projectMaterial.ts), which is
 * the exact same contract: a clearable FK picked from a project-scoped
 * <select>.
 */
export const optionalPositiveIntId = z
    .preprocess(
        (v) => (v === "" || v === null || v === undefined ? null : v),
        z.coerce.number().int().positive().nullable()
    )
    .optional();

/**
 * A managed job function id coming from a <select> (or CSV import): a positive
 * integer, or null when "none" ("") is chosen. Optional so the field may be
 * absent from the payload entirely. Shared by the contact, user, interim,
 * and subcontractor schemas.
 */
export const optionalJobFunctionId = optionalPositiveIntId;

/**
 * Matches every database CHECK's `!~ '[[:cntrl:]]'` clause: rejects a
 * smuggled newline/tab in a one-line label rendered into HTML and drawn into
 * a PDF report on a single line (originally schemas/reserve.ts, now shared).
 *
 * Wider than ASCII on purpose. Postgres's `[[:cntrl:]]` under a UTF-8 ctype
 * also rejects the C1 range (U+0080–U+009F — what a `€` pasted from a
 * mis-decoded Windows-1252 document becomes); a Zod that stopped at \x7f let
 * those through to the CHECK, turning a field error into a generic "server
 * error" (proven on the local base, 2026-09-19). U+2028/U+2029 are added for
 * the other half of the promise: pdfkit's line breaker (UAX #14) treats them
 * as mandatory breaks, so a "one-line" label would still wrap.
 */
export const CONTROL_CHAR = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/;

// ---------------------------------------------------------------------------
// Dates (F9). Before this the only guard was `!isNaN(Date.parse(v))`, copied
// into four schemas: it accepted "2026-02-30" (Date.parse rolls it over),
// "1/2/3", and any year up to 275760, and nothing tied a project's end to its
// start. One strict primitive now, shared.
// ---------------------------------------------------------------------------

// Year bounds for every stored date. 1900 is before any plausible chantier,
// loan or intervention; 2100 is far past any planning horizon. They exist to
// stop typos (0026, 20266) and values that overflow a downstream
// `toISOString()`, not to encode a business rule. Measured: every date in
// production is in 2026.
export const MIN_DATE_YEAR = 1900;
export const MAX_DATE_YEAR = 2100;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
// A full ISO-8601 instant with an explicit zone: what lib/datetimeLocal.ts's
// datetimeLocalToIso sends for an <input type="datetime-local"> (a bare
// "YYYY-MM-DDTHH:mm" is NOT accepted: it carries no zone, and the server would
// read it in its own).
const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-](\d{2}):(\d{2}))$/;

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (year < MIN_DATE_YEAR || year > MAX_DATE_YEAR) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/** "AAAA-MM-JJ", a real calendar date, year within [MIN_DATE_YEAR, MAX_DATE_YEAR]. */
export function isValidIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  return m !== null && isRealCalendarDate(Number(m[1]), Number(m[2]), Number(m[3]));
}

/** A zoned ISO-8601 instant ("2026-08-01T07:30:00.000Z"), real date and time, year in bounds. */
export function isValidIsoInstant(value: string): boolean {
  const m = ISO_INSTANT.exec(value);
  if (m === null) return false;
  const [hour, minute, second] = [Number(m[4]), Number(m[5]), Number(m[6] ?? 0)];
  const [offHour, offMinute] = [Number(m[7] ?? 0), Number(m[8] ?? 0)];
  if (hour > 23 || minute > 59 || second > 59 || offHour > 23 || offMinute > 59) return false;
  return isRealCalendarDate(Number(m[1]), Number(m[2]), Number(m[3]));
}

const INVALID_DATE = { message: "Date invalide", params: { i18n: "invalidDate" } };

/** Required "AAAA-MM-JJ" (an <input type="date"> value). */
export const requiredDateField = z
  .string()
  .min(1, "La date est requise")
  .refine(isValidIsoDate, INVALID_DATE);

/** Optional "AAAA-MM-JJ": empty/blank means "not provided" (undefined), anything else must be valid. */
export const optionalDateField = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined))
  .refine((v) => v === undefined || isValidIsoDate(v), INVALID_DATE);

/** Required zoned instant, for an <input type="datetime-local"> converted client-side. */
export const requiredDateTimeField = z
  .string()
  .min(1, "La date est requise")
  .refine(isValidIsoInstant, INVALID_DATE);

// ---------------------------------------------------------------------------
// Partial writes: "absent" is not "empty" (lot 5b).
//
// An UPDATE payload distinguishes three states per field, and the three must
// reach the repository as three different values:
//
//   key absent from the payload      -> undefined  (the column is left alone)
//   key present, blank or null       -> null       (the column is cleared)
//   key present, with a value        -> the value
//
// The create schemas fold blank into `undefined` ("not provided"), which is
// right for a create and wrong for an update: there, `undefined` then meant
// both "the user emptied the field" and "the caller never sent it", and the
// repository's `?? null` wrote NULL over a value nobody had asked to touch.
// Every form but one always sends every field, so it cannot show the
// difference — a direct call to the action can. The exception is
// EditMaterialForm, which renders the requiredQuantity input (and so sends
// it) only while a link is picked: a legitimate unlink arrives with no
// requiredQuantity at all (see schemas/projectMaterial.ts). The update schemas below therefore use
// these primitives instead, and carry no `.default()`.
// ---------------------------------------------------------------------------

function isBlank(v: unknown): boolean {
  return v === null || (typeof v === "string" && v.trim() === "");
}

/**
 * Wraps a schema for a CLEARABLE field of an update payload: blank ("", "  ")
 * or an explicit `null` resolve to `null` (clear), a non-blank value is
 * validated by `inner`, and an absent key stays `undefined` (leave alone) —
 * the outer `.optional()` is what short-circuits an absent key before the
 * preprocess runs (same reasoning as optionalPositiveIntId above).
 * `inner` sees only non-blank values; it does not need to accept null.
 */
export function clearable<T extends z.ZodType>(inner: T) {
  return z.preprocess((v) => (isBlank(v) ? null : v), inner.nullable()).optional();
}

/** A finite number typed in a text/number input ("1e999" is Infinity, which a bare NaN check lets through). */
export const finiteNumberText = z
  .string()
  .transform((v) => Number(v))
  .refine((v) => Number.isFinite(v), { message: "Must be a number", params: { i18n: "notANumber" } });

/** Update counterpart of optionalDateField: absent -> undefined, blank/null -> null, else a valid "AAAA-MM-JJ". */
export const clearableDateField = clearable(z.string().trim().refine(isValidIsoDate, INVALID_DATE));
