import z from "zod";

export const createJobFunctionSchema = z.object({
    name: z.string().trim().min(1, "Le nom est requis").max(80, "80 caractères maximum"),
});

export type CreateJobFunctionInput = z.infer<typeof createJobFunctionSchema>;
