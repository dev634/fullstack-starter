import z from "zod";
import { optionalJobFunctionId, MAX_EMAIL_LENGTH } from "@/schemas/fields";

export const userRoleSchema = z.enum(["SUPERADMIN", "ADMIN", "EDITOR", "VIEWER", "CLIENT"]);

// Passe 3a, point 5: email had no upper bound — same defect already fixed
// on the other email fields (adversarial pass 2, point 5).
export const createUserSchema = z.object({
    email: z.string().trim().email("Adresse email invalide").max(MAX_EMAIL_LENGTH),
    name: z.string().trim().max(120).optional(),
    role: userRoleSchema,
    jobFunctionId: optionalJobFunctionId,
    password: z.string().min(8, "Le mot de passe doit contenir au moins 8 caractères"),
});

export const updateUserSchema = z.object({
    id: z.coerce.number().int().positive(),
    name: z.string().trim().max(120).optional(),
    role: userRoleSchema,
    jobFunctionId: optionalJobFunctionId,
    // Optional: only present when the admin wants to reset the password.
    password: z.preprocess(
        (v) => (v === "" || v === null || v === undefined ? undefined : v),
        z.string().min(8, "Le mot de passe doit contenir au moins 8 caractères").optional()
    ).optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
