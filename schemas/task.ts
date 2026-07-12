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
