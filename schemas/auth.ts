import z from "zod";
import { MAX_EMAIL_LENGTH } from "@/schemas/fields";

// Passe 3a, point 5: email had no upper bound — same defect already fixed
// on the other email fields (adversarial pass 2, point 5).
export const loginSchema = z.object({
    email: z.string().email("Invalid email address").max(MAX_EMAIL_LENGTH),
    password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const requestResetSchema = z.object({
    email: z.string().email("Invalid email address").max(MAX_EMAIL_LENGTH),
});

export type RequestResetInput = z.infer<typeof requestResetSchema>;

export const resetPasswordSchema = z
    .object({
        token: z.string().min(1, "Missing token"),
        password: z.string().min(8, "Password must be at least 8 characters"),
        confirmPassword: z.string().min(1, "Please confirm your password"),
    })
    .refine((data) => data.password === data.confirmPassword, {
        message: "Passwords do not match",
        path: ["confirmPassword"],
        params: { i18n: "passwordMismatch" },
    });

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
