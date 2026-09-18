import z from "zod";
import { MAX_NAME_LENGTH, MAX_REFERENCE_LENGTH } from "@/schemas/fields";

// Matches migration 20260918120000's Equipment_name_check /
// Equipment_reference_check (btrim(...) > 0, length <= N, no control
// character) — same regex as schemas/reserve.ts's one-line pill label, not
// extracted to schemas/fields.ts here since that file is outside this
// change's scoped file list; flagged in the delivery report as a candidate
// for a shared helper the day a third caller needs it.
const CONTROL_CHAR = /[\x00-\x1f\x7f]/;

const nameSchema = z
    .string()
    .trim()
    .min(1, "Le nom est requis")
    .max(MAX_NAME_LENGTH)
    .refine((v) => !CONTROL_CHAR.test(v), { message: "Invalid characters", params: { i18n: "invalidCharacters" } });

// Empty (or whitespace-only) means "no reference" — mapped to `undefined` so
// the repository can store NULL, the ONE representation the
// Equipment_reference_check CHECK allows for "none" (a stored "" or "   "
// fails it with a 23514).
const optionalReference = z
    .string()
    .trim()
    .max(MAX_REFERENCE_LENGTH)
    .refine((v) => v === "" || !CONTROL_CHAR.test(v), {
        message: "Invalid characters",
        params: { i18n: "invalidCharacters" },
    })
    .optional()
    .transform((v) => (v && v !== "" ? v : undefined));

export const createEquipmentSchema = z.object({
    name: nameSchema,
    reference: optionalReference,
});

export const updateEquipmentSchema = createEquipmentSchema.extend({
    id: z.coerce.number().int().positive(),
});

export type CreateEquipmentInput = z.infer<typeof createEquipmentSchema>;
export type UpdateEquipmentInput = z.infer<typeof updateEquipmentSchema>;
