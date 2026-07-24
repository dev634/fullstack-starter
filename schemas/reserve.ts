import z from "zod";

export const reserveStatusSchema = z.enum(["OPEN", "RESOLVED"]);

// Optional numeric coming from a form: empty string / null → undefined,
// otherwise coerced and range-checked (z.coerce.number() alone would turn ""
// into 0). The outer .optional() is required: a z.preprocess wrapper is a
// ZodEffects, which an object treats as a REQUIRED key even when its inner
// schema is optional — so an absent lat/lng (no GPS) would otherwise fail.
const optionalCoord = (min: number, max: number) =>
    z
        .preprocess(
            (v) => (v === "" || v === null || v === undefined ? undefined : v),
            z.coerce.number().min(min).max(max).optional()
        )
        .optional();

export const createReserveSchema = z.object({
    planId: z.coerce.number().int().positive(),
    x: z.coerce.number().min(0).max(1),
    y: z.coerce.number().min(0).max(1),
    description: z.string().min(1, "La description est requise"),
    status: reserveStatusSchema.default("OPEN"),
    latitude: optionalCoord(-90, 90),
    longitude: optionalCoord(-180, 180),
});

export const updateReserveSchema = z.object({
    id: z.coerce.number().int().positive(),
    description: z.string().min(1, "La description est requise"),
    status: reserveStatusSchema.default("OPEN"),
    latitude: optionalCoord(-90, 90),
    longitude: optionalCoord(-180, 180),
});

export type CreateReserveInput = z.infer<typeof createReserveSchema>;
export type UpdateReserveInput = z.infer<typeof updateReserveSchema>;
