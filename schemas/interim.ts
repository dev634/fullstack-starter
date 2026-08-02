import z from "zod";
import { optionalJobFunctionId } from "@/schemas/fields";

export const createInterimSchema = z.object({
    projectId: z.coerce.number().int().positive(),
    clientId: z.coerce.number().int().positive(),
    name: z.string().min(1, "Le nom est requis"),
    jobFunctionId: optionalJobFunctionId,
    agency: z.string().optional(),
});

export type CreateInterimInput = z.infer<typeof createInterimSchema>;
