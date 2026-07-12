import z from "zod";

export const projectStatusSchema = z.enum([
    "ETUDE",
    "SIGNE",
    "EN_COURS",
    "RACCORDEMENT",
    "TERMINE",
    "ANNULE",
]);

// Numeric/date fields arrive as strings from HTML form inputs — coerce and
// treat an empty string as "not provided" (optional) rather than a zod error.
const optionalNumber = z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? Number(v) : undefined))
    .refine((v) => v === undefined || !Number.isNaN(v), "Must be a number");

const optionalDate = z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v : undefined));

export const createProjectSchema = z.object({
    clientId: z.coerce.number().int().positive(),
    name: z.string().min(1, "Project name is required"),
    status: projectStatusSchema.default("ETUDE"),
    power: optionalNumber,
    budget: optionalNumber,
    address: z.string().optional(),
    startDate: optionalDate,
    endDate: optionalDate,
    notes: z.string().optional(),
});

export const updateProjectSchema = createProjectSchema.extend({
    id: z.coerce.number().int().positive(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
