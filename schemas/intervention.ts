import z from "zod";

export const interventionStatusSchema = z.enum(["PLANIFIEE", "FAITE", "ANNULEE"]);

// The client sends a full ISO-8601 instant (see lib/datetimeLocal.ts) so the
// stored time is timezone-unambiguous; guard against a non-parseable string
// reaching the repository's `new Date(...)` rather than only relying on the
// DB to reject an Invalid Date.
const scheduledAtSchema = z
    .string()
    .min(1, "La date est requise")
    .refine((v) => !isNaN(Date.parse(v)), { message: "Date invalide" });

export const createInterventionSchema = z.object({
    projectId: z.coerce.number().int().positive(),
    clientId: z.coerce.number().int().positive(),
    scheduledAt: scheduledAtSchema,
    description: z.string().min(1, "La description est requise"),
    technician: z.string().optional(),
});

export type CreateInterventionInput = z.infer<typeof createInterventionSchema>;

export const updateInterventionSchema = z.object({
    id: z.coerce.number().int().positive(),
    projectId: z.coerce.number().int().positive(),
    clientId: z.coerce.number().int().positive(),
    scheduledAt: scheduledAtSchema,
    description: z.string().min(1, "La description est requise"),
    technician: z.string().optional(),
    status: interventionStatusSchema.default("PLANIFIEE"),
});

export type UpdateInterventionInput = z.infer<typeof updateInterventionSchema>;
