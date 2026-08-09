import z from "zod";
import { optionalJobFunctionId, MAX_NAME_LENGTH } from "@/schemas/fields";

// Adversarial pass 2, point 5: name/agency had no upper bound.
export const createInterimSchema = z.object({
    projectId: z.coerce.number().int().positive(),
    clientId: z.coerce.number().int().positive(),
    name: z.string().min(1, "Le nom est requis").max(MAX_NAME_LENGTH),
    jobFunctionId: optionalJobFunctionId,
    agency: z.string().max(MAX_NAME_LENGTH).optional(),
});

export type CreateInterimInput = z.infer<typeof createInterimSchema>;
