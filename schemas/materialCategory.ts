import z from "zod";
import { MAX_NAME_LENGTH, CONTROL_CHAR } from "@/schemas/fields";

// Same tier as every other name/title in this app (schemas/taskCategory.ts's
// own comment) — not a new number, so a material category name and a task
// category name can't drift apart. Mirrors the three CHECK clauses of
// migration 20260906120000_project_material_category exactly, so Zod and the
// database agree on what a name is:
//   - .trim() + .min(1): btrim(name) > 0 — a whitespace-only name is rejected
//     the same way an empty one is, not silently stored as-is.
//   - .max(MAX_NAME_LENGTH): length(name) <= 200.
//   - the CONTROL_CHAR refine: name !~ '[[:cntrl:]]', so a newline/tab can't
//     be smuggled into a label laid out on a single line.
// Defined once and shared by create/update below — it was copied twice
// before, which is exactly how the two could have drifted apart.
export const materialCategoryName = z
    .string()
    .trim()
    .min(1, "Le nom de la catégorie est requis")
    .max(MAX_NAME_LENGTH)
    .refine((v) => !CONTROL_CHAR.test(v), { message: "Invalid characters", params: { i18n: "invalidCharacters" } });

export const createMaterialCategorySchema = z.object({
    projectId: z.coerce.number().int().positive(),
    clientId: z.coerce.number().int().positive(),
    name: materialCategoryName,
});

export type CreateMaterialCategoryInput = z.infer<typeof createMaterialCategorySchema>;

// Renaming — the only field a material category owns besides its project and
// id (it has no groups, tasks or assignee to carry, unlike ProjectTaskCategory).
export const updateMaterialCategorySchema = z.object({
    id: z.coerce.number().int().positive(),
    projectId: z.coerce.number().int().positive(),
    clientId: z.coerce.number().int().positive(),
    name: materialCategoryName,
});

export type UpdateMaterialCategoryInput = z.infer<typeof updateMaterialCategorySchema>;
