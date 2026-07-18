import z from "zod";

export const interventionStatusSchema = z.enum(["PLANIFIEE", "FAITE", "ANNULEE"]);

export const createInterventionSchema = z.object({
    projectId: z.coerce.number().int().positive(),
    clientId: z.coerce.number().int().positive(),
    scheduledAt: z.string().min(1, "La date est requise"),
    description: z.string().min(1, "La description est requise"),
    technician: z.string().optional(),
});

export type CreateInterventionInput = z.infer<typeof createInterventionSchema>;

export const updateInterventionSchema = z.object({
    id: z.coerce.number().int().positive(),
    projectId: z.coerce.number().int().positive(),
    clientId: z.coerce.number().int().positive(),
    scheduledAt: z.string().min(1, "La date est requise"),
    description: z.string().min(1, "La description est requise"),
    technician: z.string().optional(),
    status: interventionStatusSchema.default("PLANIFIEE"),
});

export type UpdateInterventionInput = z.infer<typeof updateInterventionSchema>;
