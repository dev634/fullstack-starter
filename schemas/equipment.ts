import z from "zod";
import { MAX_NAME_LENGTH, MAX_REFERENCE_LENGTH, CONTROL_CHAR } from "@/schemas/fields";

// CONTROL_CHAR mirrors migration 20260918120000's Equipment_name_check /
// Equipment_reference_check (btrim(...) > 0, length <= N, `!~ '[[:cntrl:]]'`),
// and it is IMPORTED, never redeclared: this file used to carry its own
// `/[\x00-\x1f\x7f]/`, which stops at ASCII while Postgres's [[:cntrl:]]
// under a UTF-8 ctype also rejects the C1 range (U+0080–U+009F — what a `€`
// pasted from a mis-decoded Windows-1252 document becomes). A name carrying
// one of those traversed Zod and died on the CHECK as a generic "server
// error" instead of a field error. Third time this class of divergence was
// paid; tests/schema-control-char.test.ts now refuses the redeclaration.

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
