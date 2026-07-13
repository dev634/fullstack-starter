import z from "zod";

const optionalDate = z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v : undefined));

export const createTaskSchema = z.object({
    projectId: z.coerce.number().int().positive(),
    clientId: z.coerce.number().int().positive(),
    title: z.string().min(1, "Le titre de la tâche est requis"),
    dueDate: optionalDate,
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const MAX_SERIES_SIZE = 200;

/**
 * Bulk-generate numbered tasks from a pattern, e.g. "String {n}" from 1 to 27
 * creates 27 tasks titled "String 1".."String 27". `{n}` must appear in the
 * pattern (otherwise every generated title would be identical), and the
 * range is capped to avoid an accidental typo (e.g. "to: 99999") creating an
 * unbounded number of rows.
 */
export const createTaskSeriesSchema = z
    .object({
        projectId: z.coerce.number().int().positive(),
        clientId: z.coerce.number().int().positive(),
        pattern: z.string().min(1, "Le motif est requis"),
        from: z.coerce.number().int(),
        to: z.coerce.number().int(),
    })
    .refine((data) => data.pattern.includes("{n}"), {
        message: "Le motif doit contenir {n}",
        path: ["pattern"],
        params: { i18n: "patternMissingPlaceholder" },
    })
    .refine((data) => data.to >= data.from, {
        message: "La valeur « à » doit être supérieure ou égale à « de »",
        path: ["to"],
        params: { i18n: "seriesRangeInvalid" },
    })
    .refine((data) => data.to - data.from + 1 <= MAX_SERIES_SIZE, {
        message: `La série ne peut pas dépasser ${MAX_SERIES_SIZE} tâches`,
        path: ["to"],
        params: { i18n: "seriesTooLarge" },
    });

export type CreateTaskSeriesInput = z.infer<typeof createTaskSeriesSchema>;
