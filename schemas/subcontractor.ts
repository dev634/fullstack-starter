import z from "zod";
import { optionalJobFunctionId } from "@/schemas/fields";

export const createSubcontractorCompanySchema = z.object({
    projectId: z.coerce.number().int().positive(),
    clientId: z.coerce.number().int().positive(),
    name: z.string().min(1, "Le nom de l'entreprise est requis"),
});

export type CreateSubcontractorCompanyInput = z.infer<typeof createSubcontractorCompanySchema>;

export const addSubcontractorPersonSchema = z.object({
    companyId: z.coerce.number().int().positive(),
    projectId: z.coerce.number().int().positive(),
    clientId: z.coerce.number().int().positive(),
    name: z.string().min(1, "Le nom est requis"),
    jobFunctionId: optionalJobFunctionId,
    phone: z.string().optional(),
});

export type AddSubcontractorPersonInput = z.infer<typeof addSubcontractorPersonSchema>;
