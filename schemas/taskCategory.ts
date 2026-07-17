import z from "zod";

export const createTaskCategorySchema = z.object({
    projectId: z.coerce.number().int().positive(),
    clientId: z.coerce.number().int().positive(),
    name: z.string().min(1, "Le nom du groupe est requis"),
});

export type CreateTaskCategoryInput = z.infer<typeof createTaskCategorySchema>;
