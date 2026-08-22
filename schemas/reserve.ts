import z from "zod";
import { MAX_NOTE_LENGTH } from "@/schemas/fields";

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
