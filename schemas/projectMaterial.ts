import z from "zod";
// Shared with the delivery-note scan flow (schemas/deliveryNoteScan.ts) —
// see MAX_SCAN_QUANTITY's own comment there for why: `quantity` feeds the
// exact same Float `increment` path (repository/projectMaterials.ts's
// createOrAccumulate) whether it arrives from a scan or this manual form, so
// the scan path's ceiling used to be the only one enforced — the manual form
// let a value like 1e308 through, and worse, a SECOND manual entry with the
// same reference then hit createOrAccumulate's `increment` and made Postgres
// itself raise "value out of range: overflow", leaving that line impossible
// to top up again (adversarial pass 2, point 6). One shared constant, not a
// second number that could drift from it.
import { MAX_SCAN_QUANTITY } from "@/schemas/deliveryNoteScan";

// Empty string (nothing picked/typed) means "not provided" rather than a
// validation error — same convention as schemas/project.ts's optionalNumber.
// Number.isFinite(v) is required alongside v > 0: Infinity is > 0 but isn't a
// usable quantity — Number("1e999") is Infinity, not NaN, so it used to pass
// straight through into requiredQuantity (a Float column) — see adversarial
// pass 2, point 2 (same trap as schemas/project.ts's optionalNumber, whose
// comment explains why this stays a `.refine()` rather than switching to
// z.coerce.number()).
// .max(MAX_SCAN_QUANTITY): passe 3a, point 5 — requiredQuantity stayed
// uncapped after `quantity`, just above, was given this exact ceiling
// (adversarial pass 2, point 6). Same Float column class of risk: a
// requiredQuantity just under Infinity is compared against `quantity` by
// lib/materialStock.ts on every render, never written via an `increment`
// itself, but there's no reason for it to accept a value the sibling field
// on the very same row can't.
const optionalPositiveNumber = z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? Number(v) : undefined))
    .refine((v) => v === undefined || (Number.isFinite(v) && v > 0 && v <= MAX_SCAN_QUANTITY), {
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
        // .max(MAX_SCAN_QUANTITY): see this file's import comment — same
        // ceiling as the scan path, for the same Float `increment` column.
        quantity: z.coerce
            .number()
            .nonnegative("La quantité doit être un nombre positif ou nul")
            .max(MAX_SCAN_QUANTITY, "La quantité est trop élevée"),
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

// Editing a material can now change its link (task/series/category) too —
// same single `link` picker convention as createMaterialSchema. An empty
// pick clears the link; picking a target requires requiredQuantity, so the
// stock indicator has something to compare against.
export const updateMaterialSchema = z
    .object({
        id: z.coerce.number().int().positive(),
        projectId: z.coerce.number().int().positive(),
        clientId: z.coerce.number().int().positive(),
        name: z.string().min(1, "Le nom du matériel est requis"),
        quantity: z.coerce
            .number()
            .nonnegative("La quantité doit être un nombre positif ou nul")
            .max(MAX_SCAN_QUANTITY, "La quantité est trop élevée"),
        unit: z.string().optional(),
        supplierName: z.string().optional(),
        reference: z.string().optional(),
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

export type UpdateMaterialInput = z.infer<typeof updateMaterialSchema>;
