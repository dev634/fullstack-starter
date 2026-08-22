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
export const MAX_CODE_LENGTH = 40; // a short structured code: a postal code, a business/reference number
export const MAX_NOTE_LENGTH = 5000; // free-form prose: a description, project notes
export const MAX_EMAIL_LENGTH = 254; // RFC 5321's practical mailbox length limit
export const MAX_URL_LENGTH = 2048; // common browser/URL-bar length ceiling
// 30 was a defect, not a tier: this constant's own former comment described
// "an international number with formatting (spaces, +, extension)" as the
// use case, but neither of the two most ordinary shapes of that fits —
// "+33 (0)1 23 45 67 89 poste 1234" and "01 23 45 67 89 / 06 12 34 56 78" are
// both 31 characters — so a company/contact record that already carried two
// phone numbers (office + mobile, a very common case) could no longer be
// re-saved at all. Measured up from there rather than rounded: two full
// international numbers each labelled ("+33 1 23 45 67 89 (bureau) / +33 6
// 12 34 56 78 (mobile)") is 55 characters. 60 leaves a small margin above
// that measured worst case, not an arbitrary round number.
export const MAX_PHONE_LENGTH = 60; // one formatted international number with an extension, or two numbers separated by " / " — see the measured examples above

/**
 * A managed job function id coming from a <select> (or CSV import): a positive
 * integer, or null when "none" ("") is chosen. Optional so the field may be
 * absent from the payload entirely. Shared by the contact, user, interim,
 * and subcontractor schemas.
 */
export const optionalJobFunctionId = z
    .preprocess(
        (v) => (v === "" || v === null || v === undefined ? null : v),
        z.coerce.number().int().positive().nullable()
    )
    .optional();
