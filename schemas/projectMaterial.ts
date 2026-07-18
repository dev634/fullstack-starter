import z from "zod";

// Empty string (nothing picked/typed) means "not provided" rather than a
// validation error — same convention as schemas/project.ts's optionalNumber.
const optionalPositiveNumber = z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? Number(v) : undefined))
    .refine((v) => v === undefined || v > 0, {
        message: "Must be a positive number",
        params: { i18n: "notANumber" },
    });

// The picker submits a single field encoding what's linked: "" (nothing),
// "task:<id>" (an individual standalone task), "group:<id>" (a whole task
// series), or "category:<id>" (a whole task category) — a native <select>
// can only carry one name/value pair, and the three kinds are mutually
// exclusive by construction of the dropdown.
const linkTarget = z
    .string()
    .optional()
    .transform((v) => {
        const empty = { taskId: undefined, taskGroupId: undefined, taskCategoryId: undefined };
        const [kind, idStr] = (v ?? "").split(":");
        const id = Number(idStr);
        if (!Number.isInteger(id) || id <= 0) return empty;
        if (kind === "task") return { ...empty, taskId: id };
        if (kind === "group") return { ...empty, taskGroupId: id };
        if (kind === "category") return { ...empty, taskCategoryId: id };
        return empty;
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
        // When a task or task-series is linked, requiredQuantity drives the
        // stock indicator (see lib/materialStock.ts) — comparing quantity in
        // stock against it.
        link: linkTarget,
        requiredQuantity: optionalPositiveNumber,
    })
    .transform((data) => {
        const { link, ...rest } = data;
        return { ...rest, taskId: link.taskId, taskGroupId: link.taskGroupId, taskCategoryId: link.taskCategoryId };
    })
    .refine(
        (data) =>
            (data.taskId === undefined && data.taskGroupId === undefined && data.taskCategoryId === undefined) ||
            data.requiredQuantity !== undefined,
        {
            message: "La quantité requise est nécessaire quand une tâche, une série ou un groupe est lié",
            path: ["requiredQuantity"],
            params: { i18n: "requiredQuantityMissing" },
        }
    );

export type CreateMaterialInput = z.infer<typeof createMaterialSchema>;

// Editing a material never touches its link (task/series/category) — that's
// set once at creation and changed by unlinking/relinking, not by this form.
// isLinked is submitted as a hidden field (not itself editable) purely so
// this refine can still require requiredQuantity while the material stays
// linked — the same rule createMaterialSchema enforces at creation.
export const updateMaterialSchema = z
    .object({
        id: z.coerce.number().int().positive(),
        projectId: z.coerce.number().int().positive(),
        clientId: z.coerce.number().int().positive(),
        name: z.string().min(1, "Le nom du matériel est requis"),
        quantity: z.coerce.number().nonnegative("La quantité doit être un nombre positif ou nul"),
        unit: z.string().optional(),
        supplierName: z.string().optional(),
        reference: z.string().optional(),
        isLinked: z
            .string()
            .optional()
            .transform((v) => v === "true"),
        requiredQuantity: optionalPositiveNumber,
    })
    .refine((data) => !data.isLinked || data.requiredQuantity !== undefined, {
        message: "La quantité requise est nécessaire quand une tâche, une série ou un groupe est lié",
        path: ["requiredQuantity"],
        params: { i18n: "requiredQuantityMissing" },
    });

export type UpdateMaterialInput = z.infer<typeof updateMaterialSchema>;
