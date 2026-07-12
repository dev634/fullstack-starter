import z from "zod";

export const createFolderSchema = z.object({
    projectId: z.coerce.number().int().positive(),
    clientId: z.coerce.number().int().positive(),
    parentId: z.coerce.number().int().positive().optional(),
    name: z.string().min(1, "Le nom du dossier est requis"),
});

export type CreateFolderInput = z.infer<typeof createFolderSchema>;
