import z from "zod";
import { MAX_NAME_LENGTH } from "@/schemas/fields";

// Adversarial pass 2, point 5: name had no upper bound.
export const createFolderSchema = z.object({
    projectId: z.coerce.number().int().positive(),
    clientId: z.coerce.number().int().positive(),
    parentId: z.coerce.number().int().positive().optional(),
    name: z.string().min(1, "Le nom du dossier est requis").max(MAX_NAME_LENGTH),
});

export type CreateFolderInput = z.infer<typeof createFolderSchema>;
