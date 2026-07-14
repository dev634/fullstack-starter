import z from "zod";

// Strict 6-digit hex only — this value is injected directly into a <style>
// tag in the root layout, so anything looser (arbitrary CSS functions,
// url(), etc.) would be a CSS/script injection vector.
const hexColor = z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Must be a hex color like #3b82f6");

export const updateAppSettingsSchema = z.object({
    appName: z.string().min(1, "App name is required").max(60),
    primaryColor: hexColor,
    accentColor: hexColor,
});

export type UpdateAppSettingsInput = z.infer<typeof updateAppSettingsSchema>;
