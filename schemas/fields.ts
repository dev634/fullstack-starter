import z from "zod";

/**
 * A managed job function id coming from a <select> (or CSV import): a positive
 * integer, or null when "none" ("") is chosen. Optional so the field may be
 * absent from the payload entirely. Shared by the contact, user, and interim
 * schemas.
 */
export const optionalJobFunctionId = z
    .preprocess(
        (v) => (v === "" || v === null || v === undefined ? null : v),
        z.coerce.number().int().positive().nullable()
    )
    .optional();
