import z from "zod";
import { MAX_NAME_LENGTH } from "@/schemas/fields";

// Passe 3a, point 5: name had no upper bound — same defect already fixed on
// the other name-like fields (adversarial pass 2, point 5).
export const createTaskCategorySchema = z.object({
    projectId: z.coerce.number().int().positive(),
    clientId: z.coerce.number().int().positive(),
    name: z.string().min(1, "Le nom du groupe est requis").max(MAX_NAME_LENGTH),
});

export type CreateTaskCategoryInput = z.infer<typeof createTaskCategorySchema>;
