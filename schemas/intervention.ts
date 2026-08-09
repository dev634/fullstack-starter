import z from "zod";
import { MAX_NAME_LENGTH, MAX_NOTE_LENGTH } from "@/schemas/fields";

export const interventionStatusSchema = z.enum(["PLANIFIEE", "FAITE", "ANNULEE"]);

// The client sends a full ISO-8601 instant (see lib/datetimeLocal.ts) so the
// stored time is timezone-unambiguous; guard against a non-parseable string
// reaching the repository's `new Date(...)` rather than only relying on the
// DB to reject an Invalid Date.
const scheduledAtSchema = z
    .string()
    .min(1, "La date est requise")
    .refine((v) => !isNaN(Date.parse(v)), { message: "Date invalide" });

// Adversarial pass 2, point 5: description/technician had no upper bound.
export const createInterventionSchema = z.object({
    projectId: z.coerce.number().int().positive(),
    clientId: z.coerce.number().int().positive(),
    scheduledAt: scheduledAtSchema,
    description: z.string().min(1, "La description est requise").max(MAX_NOTE_LENGTH),
    technician: z.string().max(MAX_NAME_LENGTH).optional(),
});

export type CreateInterventionInput = z.infer<typeof createInterventionSchema>;

export const updateInterventionSchema = z.object({
    id: z.coerce.number().int().positive(),
    projectId: z.coerce.number().int().positive(),
    clientId: z.coerce.number().int().positive(),
    scheduledAt: scheduledAtSchema,
    description: z.string().min(1, "La description est requise").max(MAX_NOTE_LENGTH),
    technician: z.string().max(MAX_NAME_LENGTH).optional(),
    status: interventionStatusSchema.default("PLANIFIEE"),
});

export type UpdateInterventionInput = z.infer<typeof updateInterventionSchema>;
