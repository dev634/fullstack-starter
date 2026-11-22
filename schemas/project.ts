import z from "zod";
import { MAX_NAME_LENGTH, MAX_LINE_LENGTH, MAX_CODE_LENGTH, MAX_NOTE_LENGTH, optionalDateField } from "@/schemas/fields";

export const projectStatusSchema = z.enum([
    "ETUDE",
    "SIGNE",
    "EN_COURS",
    "RACCORDEMENT",
    "TERMINE",
    "ANNULE",
]);

export const projectTypeSchema = z.enum([
    "CENTRALE_AU_SOL",
    "OMBRIERE",
    "TOITURE",
    "AUTRE",
]);

// Numeric/date fields arrive as strings from HTML form inputs — coerce and
// treat an empty string as "not provided" (optional) rather than a zod error.
// Guards Number.isFinite, not just !Number.isNaN: Number("1e999") is
// Infinity, which is neither NaN nor <= 0, so a bare NaN check let it (and
// its negative counterpart, -Infinity) straight through into Project.power /
// Project.budget (Float columns) — see adversarial pass 2, point 2. Kept as
// a `.refine()` on the already-coerced value (rather than switching to
// z.coerce.number(), which also rejects Infinity) specifically to preserve
// the dedicated "notANumber" i18n message: z.coerce.number()'s own
// invalid_type issue has no field-specific i18n hook and would fall back to
// the generic "this field is required" message (lib/i18n/zodErrors.ts) for a
// field that isn't actually empty, just malformed.
const optionalNumber = z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? Number(v) : undefined))
    .refine((v) => v === undefined || Number.isFinite(v), { message: "Must be a number", params: { i18n: "notANumber" } });

// Adversarial pass 2, point 5: none of the free-text fields below had an
// upper bound before — see schemas/fields.ts for the tier constants.
const createProjectFields = z.object({
    clientId: z.coerce.number().int().positive(),
    name: z.string().min(1, "Project name is required").max(MAX_NAME_LENGTH),
    businessNumber: z.string().max(MAX_CODE_LENGTH).optional(),
    type: projectTypeSchema.default("AUTRE"),
    status: projectStatusSchema.default("ETUDE"),
    power: optionalNumber,
    budget: optionalNumber,
    address: z.string().max(MAX_LINE_LENGTH).optional(),
    startDate: optionalDateField,
    endDate: optionalDateField,
    notes: z.string().max(MAX_NOTE_LENGTH).optional(),
});


// start <= end, ONE rule for create, update and CSV import (the three go
// through these two schemas). Posted on the write schema, error on endDate.
// Both dates are already validated "AAAA-MM-JJ" strings (optionalDateField),
// so a lexicographic comparison is a chronological one. An absent bound never
// fails: a chantier may have only a start, or only an end.
function endNotBeforeStart(data: { startDate?: string; endDate?: string }): boolean {
    return data.startDate === undefined || data.endDate === undefined || data.endDate >= data.startDate;
}
const END_BEFORE_START = {
    message: "La date de fin ne peut pas précéder la date de début.",
    path: ["endDate"],
};

export const createProjectSchema = createProjectFields.refine(endNotBeforeStart, END_BEFORE_START);

export const updateProjectSchema = createProjectFields
    .extend({ id: z.coerce.number().int().positive() })
    .refine(endNotBeforeStart, END_BEFORE_START);

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
