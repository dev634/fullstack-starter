import z from "zod";
import { MAX_NOTE_LENGTH, MAX_NAME_LENGTH } from "@/schemas/fields";
import { hexColor } from "@/schemas/appSettings";

export const reserveStatusSchema = z.enum(["OPEN", "RESOLVED"]);

// Optional numeric coming from a form: empty string / null → undefined,
// otherwise coerced and range-checked (z.coerce.number() alone would turn ""
// into 0). The outer .optional() is required: a z.preprocess wrapper is a
// ZodEffects, which an object treats as a REQUIRED key even when its inner
// schema is optional — so an absent lat/lng (no GPS) would otherwise fail.
//
// A comma decimal separator ("48,8566") is normalized to a dot before
// coercion: this field is a free-text `inputMode="decimal"` input (not a
// native <input type="number">, which would already reject a comma at the
// browser level), and a French keyboard's numeric pad types a comma for a
// decimal point by default. Left unnormalized, Number("48,8566") is NaN,
// which z.coerce.number() reports as invalid_type — translated by
// lib/i18n/zodErrors.ts as "Ce champ est requis.", a lie on a field that
// isn't empty (adversarial pass on EDITOR, point 3). Accepting the comma
// (rather than only fixing the message) is the fix: it's the ordinary way a
// French user types a decimal here, not a malformed input.
const optionalCoord = (min: number, max: number) =>
    z
        .preprocess(
            (v) => {
                if (v === "" || v === null || v === undefined) return undefined;
                return typeof v === "string" ? v.replace(",", ".") : v;
            },
            z.coerce.number().min(min).max(max).optional()
        )
        .optional();

// Adversarial pass 2, point 5: description had no upper bound — proven
// reachable at 500 000 characters.
export const createReserveSchema = z.object({
    planId: z.coerce.number().int().positive(),
    x: z.coerce.number().min(0).max(1),
    y: z.coerce.number().min(0).max(1),
    description: z.string().min(1, "La description est requise").max(MAX_NOTE_LENGTH),
    status: reserveStatusSchema.default("OPEN"),
    latitude: optionalCoord(-90, 90),
    longitude: optionalCoord(-180, 180),
});

export const updateReserveSchema = z.object({
    id: z.coerce.number().int().positive(),
    description: z.string().min(1, "La description est requise").max(MAX_NOTE_LENGTH),
    status: reserveStatusSchema.default("OPEN"),
    latitude: optionalCoord(-90, 90),
    longitude: optionalCoord(-180, 180),
});

export type CreateReserveInput = z.infer<typeof createReserveSchema>;
export type UpdateReserveInput = z.infer<typeof updateReserveSchema>;

// --- Per-project OPEN/RESOLVED status presentation (label + colour) -------
//
// The four Project columns are nullable and NULL means "not configured, use
// the product default" (see prisma/schema.prisma's Project doc and migration
// 20260823090000). "" (a cleared text input) must resolve to that exact same
// NULL, not to an empty string reaching the database: the CHECK constraint
// rejects a blank/whitespace-only label, so letting it through here would
// turn a form submission into a 500 instead of "not configured".
//
// Both the preprocess AND the outer .optional() are needed on each field —
// same reasoning as optionalCoord above: a z.preprocess wrapper (ZodEffects)
// is treated as a required key even when its own inner schema is optional, so
// a form that never sends one of these fields at all would otherwise fail
// validation instead of resolving to "not configured".

// Matches the database CHECK's `!~ '[[:cntrl:]]'`: this is a one-line pill
// label, rendered into HTML and drawn into the PDF report on a single line —
// a smuggled newline/tab would break both renderers, not just the CHECK.
const CONTROL_CHAR = /[\x00-\x1f\x7f]/;

const nullableStatusLabel = z
    .preprocess(
        (v) => {
            if (v === null || v === undefined) return null;
            if (typeof v !== "string") return v; // let the inner schema reject non-strings
            const trimmed = v.trim();
            return trimmed === "" ? null : trimmed;
        },
        z
            .string()
            .max(MAX_NAME_LENGTH)
            .refine((v) => !CONTROL_CHAR.test(v), { message: "Invalid characters", params: { i18n: "invalidCharacters" } })
            .nullable()
    )
    .optional();

const nullableStatusColor = z
    .preprocess(
        (v) => (v === "" || v === null || v === undefined ? null : v),
        hexColor.nullable()
    )
    .optional();

export const updateReserveStatusStyleSchema = z.object({
    projectId: z.coerce.number().int().positive(),
    openLabel: nullableStatusLabel,
    openColor: nullableStatusColor,
    resolvedLabel: nullableStatusLabel,
    resolvedColor: nullableStatusColor,
});

export type UpdateReserveStatusStyleInput = z.infer<typeof updateReserveStatusStyleSchema>;
