import z from "zod";

// Same three-id shape as schemas/interim.ts's createInterimSchema (clientId
// only ever used for revalidatePath, never trusted for authorization —
// requireProjectAccess runs against parsed.data.projectId in the action).
export const attachWorkerSchema = z.object({
    projectId: z.coerce.number().int().positive(),
    clientId: z.coerce.number().int().positive(),
    userId: z.coerce.number().int().positive(),
});

export type AttachWorkerInput = z.infer<typeof attachWorkerSchema>;
