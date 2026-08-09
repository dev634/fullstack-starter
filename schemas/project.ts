import z from "zod";
import { MAX_NAME_LENGTH, MAX_LINE_LENGTH, MAX_CODE_LENGTH, MAX_NOTE_LENGTH } from "@/schemas/fields";

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

// Same convention as optionalNumber: empty string means "not provided". A
// non-empty value must still parse to a real date — an unparseable string
// (or one Date.parse "succeeds" on but is out of range, e.g. year 275760+)
// would otherwise reach the repository's `new Date(...)` unchecked, get
// stored, and blow up as an uncaught RangeError the next time something
// calls `.toISOString()` on it (see app/projects/export/route.ts). Same
// guard as schemas/intervention.ts's scheduledAtSchema.
const optionalDate = z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v : undefined))
    .refine((v) => v === undefined || !isNaN(Date.parse(v)), { message: "Date invalide" });

// Adversarial pass 2, point 5: none of the free-text fields below had an
// upper bound before — see schemas/fields.ts for the tier constants.
export const createProjectSchema = z.object({
    clientId: z.coerce.number().int().positive(),
    name: z.string().min(1, "Project name is required").max(MAX_NAME_LENGTH),
    businessNumber: z.string().max(MAX_CODE_LENGTH).optional(),
    type: projectTypeSchema.default("AUTRE"),
    status: projectStatusSchema.default("ETUDE"),
    power: optionalNumber,
    budget: optionalNumber,
    address: z.string().max(MAX_LINE_LENGTH).optional(),
    startDate: optionalDate,
    endDate: optionalDate,
    notes: z.string().max(MAX_NOTE_LENGTH).optional(),
});

export const updateProjectSchema = createProjectSchema.extend({
    id: z.coerce.number().int().positive(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
