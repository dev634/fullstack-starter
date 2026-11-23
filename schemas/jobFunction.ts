import z from "zod";

export const createJobFunctionSchema = z.object({
    name: z.string().trim().min(1, "Le nom est requis").max(80, "80 caractères maximum"),
});

/**
 * The payload of saveFunctionConfig: the three fields are REQUIRED. A missing
 * or malformed one used to be read as the neutral value (hiddenAreas -> []
 * un-hid every rubrique, an unknown scope -> "ALL"), i.e. a typo or a tampered
 * payload silently lifted restrictions. Keys inside the arrays are only
 * checked to be strings here; the action then keeps the known ones.
 */
export const functionConfigSchema = z.object({
    hiddenSections: z.array(z.string()),
    hiddenAreas: z.array(z.string()),
    projectScope: z.enum(["ALL", "ASSIGNED"]),
});

export type CreateJobFunctionInput = z.infer<typeof createJobFunctionSchema>;
