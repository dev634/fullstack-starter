import z from "zod";
import { optionalJobFunctionId } from "@/schemas/fields";

export const createContactSchema = z.object({
    clientId: z.coerce.number().int().positive(),
    firstName: z.string().min(1, "Le prénom est requis"),
    lastName: z.string().min(1, "Le nom est requis"),
    email: z.string().optional(),
    phone: z.string().optional(),
    jobFunctionId: optionalJobFunctionId,
});

export type CreateContactInput = z.infer<typeof createContactSchema>;

export const updateContactSchema = createContactSchema.extend({
    id: z.coerce.number().int().positive(),
});

export type UpdateContactInput = z.infer<typeof updateContactSchema>;
