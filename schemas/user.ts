import z from "zod";

export const userRoleSchema = z.enum(["SUPERADMIN", "ADMIN", "EDITOR", "VIEWER"]);

export const createUserSchema = z.object({
    email: z.string().trim().email("Adresse email invalide"),
    name: z.string().trim().max(120).optional(),
    role: userRoleSchema,
    password: z.string().min(8, "Le mot de passe doit contenir au moins 8 caractères"),
});

export const updateUserSchema = z.object({
    id: z.coerce.number().int().positive(),
    name: z.string().trim().max(120).optional(),
    role: userRoleSchema,
    // Optional: only present when the admin wants to reset the password.
    password: z.preprocess(
        (v) => (v === "" || v === null || v === undefined ? undefined : v),
        z.string().min(8, "Le mot de passe doit contenir au moins 8 caractères").optional()
    ).optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
