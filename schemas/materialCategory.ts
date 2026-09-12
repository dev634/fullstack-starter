import z from "zod";
import { MAX_NAME_LENGTH } from "@/schemas/fields";

// Same tier as every other name/title in this app (schemas/taskCategory.ts's
// own comment) — not a new number, so a material category name and a task
// category name can't drift apart, and Zod agrees with the database CHECK of
// migration 20260906120000_project_material_category (length <= 200).
export const createMaterialCategorySchema = z.object({
    projectId: z.coerce.number().int().positive(),
    clientId: z.coerce.number().int().positive(),
    name: z.string().min(1, "Le nom de la catégorie est requis").max(MAX_NAME_LENGTH),
});

export type CreateMaterialCategoryInput = z.infer<typeof createMaterialCategorySchema>;

// Renaming — the only field a material category owns besides its project and
// id (it has no groups, tasks or assignee to carry, unlike ProjectTaskCategory).
export const updateMaterialCategorySchema = z.object({
    id: z.coerce.number().int().positive(),
    projectId: z.coerce.number().int().positive(),
    clientId: z.coerce.number().int().positive(),
    name: z.string().min(1, "Le nom de la catégorie est requis").max(MAX_NAME_LENGTH),
});

export type UpdateMaterialCategoryInput = z.infer<typeof updateMaterialCategorySchema>;
