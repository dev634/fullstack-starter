import z from "zod";

// Empty string (nothing picked/typed) means "not provided" rather than a
// validation error — same convention as schemas/project.ts's optionalNumber.
const optionalPositiveInt = z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? Number(v) : undefined))
    .refine((v) => v === undefined || (Number.isInteger(v) && v > 0), {
        message: "Invalid task",
        params: { i18n: "notANumber" },
    });

const optionalPositiveNumber = z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? Number(v) : undefined))
    .refine((v) => v === undefined || v > 0, {
        message: "Must be a positive number",
        params: { i18n: "notANumber" },
    });

export const createMaterialSchema = z
    .object({
        projectId: z.coerce.number().int().positive(),
        clientId: z.coerce.number().int().positive(),
        name: z.string().min(1, "Le nom du matériel est requis"),
        // nonnegative (not positive): 0 is a valid, meaningful stock level —
        // it's what drives the "out of stock" (red) indicator for a linked task.
        quantity: z.coerce.number().nonnegative("La quantité doit être un nombre positif ou nul"),
        unit: z.string().optional(),
        supplierName: z.string().optional(),
        reference: z.string().optional(),
        // When a task is linked, requiredQuantity drives the stock indicator
        // (see lib/materialStock.ts) — comparing quantity in stock against it.
        taskId: optionalPositiveInt,
        requiredQuantity: optionalPositiveNumber,
    })
    .refine((data) => data.taskId === undefined || data.requiredQuantity !== undefined, {
        message: "La quantité requise est nécessaire quand une tâche est liée",
        path: ["requiredQuantity"],
        params: { i18n: "requiredQuantityMissing" },
    });

export type CreateMaterialInput = z.infer<typeof createMaterialSchema>;
