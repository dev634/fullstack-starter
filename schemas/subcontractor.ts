import z from "zod";
import { optionalJobFunctionId, MAX_NAME_LENGTH, MAX_PHONE_LENGTH } from "@/schemas/fields";

// Adversarial pass 2, point 5: name had no upper bound.
export const createSubcontractorCompanySchema = z.object({
    projectId: z.coerce.number().int().positive(),
    clientId: z.coerce.number().int().positive(),
    name: z.string().min(1, "Le nom de l'entreprise est requis").max(MAX_NAME_LENGTH),
});

export type CreateSubcontractorCompanyInput = z.infer<typeof createSubcontractorCompanySchema>;

// Adversarial pass 2, point 5: name/phone had no upper bound.
export const addSubcontractorPersonSchema = z.object({
    companyId: z.coerce.number().int().positive(),
    projectId: z.coerce.number().int().positive(),
    clientId: z.coerce.number().int().positive(),
    name: z.string().min(1, "Le nom est requis").max(MAX_NAME_LENGTH),
    jobFunctionId: optionalJobFunctionId,
    phone: z.string().max(MAX_PHONE_LENGTH).optional(),
});

export type AddSubcontractorPersonInput = z.infer<typeof addSubcontractorPersonSchema>;
