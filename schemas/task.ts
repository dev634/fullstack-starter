import z from "zod";
import { MAX_NAME_LENGTH } from "@/schemas/fields";

// Same convention as schemas/project.ts's own optionalDate (which this was
// missing — passe 3b (C2), point 3): empty string means "not provided", but
// a non-empty value must still parse to a real date. Without the .refine()
// below, an unparseable or out-of-range string (e.g. year 275760+) reached
// the repository's `new Date(...)` unchecked and got stored — the exact
// defect that made /projects/export 500 for everyone, permanently, the last
// time a date field was left unvalidated (see project.ts's own comment).
const optionalDate = z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v : undefined))
    .refine((v) => v === undefined || !isNaN(Date.parse(v)), { message: "Date invalide" });

// Empty string (nothing picked) means "not provided" rather than a
// validation error — same convention as schemas/project.ts's optionalNumber.
const optionalPositiveInt = z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? Number(v) : undefined))
    .refine((v) => v === undefined || (Number.isInteger(v) && v > 0), {
        message: "Invalid category",
        params: { i18n: "notANumber" },
    });

export const createTaskSchema = z.object({
    projectId: z.coerce.number().int().positive(),
    clientId: z.coerce.number().int().positive(),
    title: z.string().min(1, "Le titre de la tâche est requis").max(MAX_NAME_LENGTH),
    dueDate: optionalDate,
    // A standalone task can optionally track progress as a quantity (e.g.
    // "12 / 20 panneaux") instead of a plain checkbox — set once at creation.
    quantityTarget: optionalPositiveInt,
    // Optional: put this standalone task directly under an existing category
    // (e.g. "Toiture") at creation time — same idea as a series's categoryId.
    categoryId: optionalPositiveInt,
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

// Leaving quantityTarget blank on edit reverts the task to a plain checkbox
// (see repository/tasks.ts's update) — same "empty means not provided"
// convention as everywhere else in this schema.
export const updateTaskSchema = z.object({
    id: z.coerce.number().int().positive(),
    projectId: z.coerce.number().int().positive(),
    clientId: z.coerce.number().int().positive(),
    title: z.string().min(1, "Le titre de la tâche est requis").max(MAX_NAME_LENGTH),
    dueDate: optionalDate,
    quantityTarget: optionalPositiveInt,
});

export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

/**
 * updateTaskQuantity (actions/tasks/tasks.ts) is called with raw numeric
 * arguments from a client component, not FormData — but a Server Action's
 * arguments still travel over the wire in React's own serialization format,
 * which (unlike JSON) can carry NaN. The repository's clamp
 * (Math.max(0, Math.min(quantityDone, target))) holds for a negative value
 * or Infinity, but not for NaN: Math.min/Math.max propagate it, and it then
 * writes quantityDone = null (Prisma can't represent a Float NaN) with
 * done = false — a state the UI can never produce on its own, silently
 * zeroing a task's progress. Validated here rather than left to the
 * repository's clamp — adversarial pass 2, point 8.
 */
export const updateTaskQuantitySchema = z.object({
    id: z.coerce.number().int().positive(),
    quantityDone: z.coerce.number(),
    clientId: z.coerce.number().int().positive(),
    projectId: z.coerce.number().int().positive(),
});

export type UpdateTaskQuantityInput = z.infer<typeof updateTaskQuantitySchema>;

export const MAX_SERIES_SIZE = 200;

/**
 * Bulk-generate numbered tasks from a pattern, e.g. "String {n}" from 1 to 27
 * creates 27 tasks titled "String 1".."String 27". `{n}` must appear in the
 * pattern (otherwise every generated title would be identical), and the
 * range is capped to avoid an accidental typo (e.g. "to: 99999") creating an
 * unbounded number of rows.
 *
 * `pattern` is capped at MAX_NAME_LENGTH — the same bound as a plain task's
 * own `title` above — because it feeds every generated title directly
 * (repository/tasks.ts's createMany: `pattern.replaceAll("{n}", String(n))`)
 * WITHOUT going through createTaskSchema's own title bound, since that's a
 * different code path entirely. Before this, MAX_SERIES_SIZE already capped
 * the row COUNT (200) but nothing capped a single row's SIZE: a 200 KB
 * `pattern` produced 200 titles of ~200 001 characters each — ~40 MB
 * actually written from a ~200 KB request (measured: 200 rows in 961 ms).
 * Capping `pattern` itself bounds every generated title as a side effect,
 * without needing to validate each one after the fact.
 */
export const createTaskSeriesSchema = z
    .object({
        projectId: z.coerce.number().int().positive(),
        clientId: z.coerce.number().int().positive(),
        name: z.string().min(1, "Le nom de la série est requis").max(MAX_NAME_LENGTH),
        pattern: z.string().min(1, "Le motif est requis").max(MAX_NAME_LENGTH),
        from: z.coerce.number().int(),
        to: z.coerce.number().int(),
        // Optional: assign the new series directly to an existing category
        // (e.g. put "Strings onduleur" under a "Toiture" group) at creation time.
        categoryId: optionalPositiveInt,
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
