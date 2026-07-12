import z from "zod";

export const loginSchema = z.object({
    email: z.string().email("Invalid email address"),
    password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const requestResetSchema = z.object({
    email: z.string().email("Invalid email address"),
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
