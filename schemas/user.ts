import z from "zod";
import { optionalJobFunctionId, MAX_EMAIL_LENGTH, MAX_NAME_LENGTH, CONTROL_CHAR } from "@/schemas/fields";

export const userRoleSchema = z.enum(["SUPERADMIN", "ADMIN", "EDITOR", "VIEWER", "CLIENT"]);

// Passe 3a, point 5: email had no upper bound — same defect already fixed
// on the other email fields (adversarial pass 2, point 5).
//
// Refactoring point 3 (revue + audit "travailleurs"): `name` is now required,
// non-blank — a null User.name used to fall back to the raw email wherever
// this account was displayed (the assignee picker, the workforce page, the
// progress-by-travailleur aggregate); the repli neutre those places now use
// instead ("Utilisateur #{id}", lib/workerDisplayName.ts) stays necessary for
// accounts created before this change (see the DB count in this PR's own
// report), but no NEW account should be able to reach that fallback.
//
// Refactoring point 5: `name` is rendered as a plain label at six display
// sites, two of them PDF reports (the assignee picker, the workforce page,
// the progress-by-travailleur aggregate, the two réserves/dashboard PDF
// reports) — a smuggled control character in a one-line label is the same
// defect CONTROL_CHAR already guards on reserve labels and material category
// names (schemas/fields.ts's own doc). There is NO database CHECK on
// User.name (unlike those columns) — this refine exists purely for display
// safety, so it is NOT part of tests-integration/control-char-check-parity.test.ts's
// CHECK-driven GUARDED table, and must not be added there.
export const createUserSchema = z.object({
    email: z.string().trim().email("Adresse email invalide").max(MAX_EMAIL_LENGTH),
    name: z
        .string()
        .trim()
        .min(1, "Le nom est requis")
        .max(MAX_NAME_LENGTH)
        .refine((v) => !CONTROL_CHAR.test(v), { message: "Invalid characters", params: { i18n: "invalidCharacters" } }),
    role: userRoleSchema,
    jobFunctionId: optionalJobFunctionId,
    password: z.string().min(8, "Le mot de passe doit contenir au moins 8 caractères"),
});

export const updateUserSchema = z.object({
    id: z.coerce.number().int().positive(),
    // `.optional()` covers the FIELD being absent from the payload — when
    // that happens, actions/users/users.ts::updateUser falls back to the
    // target's CURRENT name (read via findById) rather than writing NULL, so
    // omitting the field preserves it. Once the field IS present (which the
    // admin form always sends, even as "" when the caller leaves it blank),
    // it must satisfy the same non-blank rule as creation, so an admin can
    // never blank out an existing name — only replace it with a new one.
    name: z
        .string()
        .trim()
        .min(1, "Le nom est requis")
        .max(MAX_NAME_LENGTH)
        .refine((v) => !CONTROL_CHAR.test(v), { message: "Invalid characters", params: { i18n: "invalidCharacters" } })
        .optional(),
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
