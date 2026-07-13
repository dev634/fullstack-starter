import z from "zod";

export const createMaterialSchema = z.object({
    projectId: z.coerce.number().int().positive(),
    clientId: z.coerce.number().int().positive(),
    name: z.string().min(1, "Le nom du matériel est requis"),
    quantity: z.coerce.number().positive("La quantité doit être un nombre positif"),
    unit: z.string().optional(),
    supplierName: z.string().optional(),
    reference: z.string().optional(),
});

export type CreateMaterialInput = z.infer<typeof createMaterialSchema>;
