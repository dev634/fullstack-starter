import z from "zod";
import { MAX_NOTE_LENGTH, requiredDateField, optionalDateField } from "@/schemas/fields";

// Dates are built from an <input type="date"> ("YYYY-MM-DD") and kept as
// strings here — the repository converts with `new Date(str)` (a UTC
// midnight). Format, calendar validity and year bounds come from
// schemas/fields.ts (requiredDateField / optionalDateField). The >= lentAt
// ordering that matches the database CHECK (migration 20260918120000) is
// enforced below for create, where lentAt is a sibling field in the SAME
// payload; editLoan/returnLoan don't carry lentAt (it never changes after
// creation), so that comparison happens in the action, against the value
// read back from the database (see actions/equipmentLoans/equipmentLoans.ts).

// Empty/whitespace-only means "no note" — mapped to `undefined` so the
// repository stores NULL, the only representation EquipmentLoan_note_check
// allows for "none". Unlike Equipment's name/reference, a note is a
// textarea and legitimately contains newlines — no control-character clause
// (matches the migration's own comment on EquipmentLoan_note_check).
const optionalNote = z
    .string()
    .trim()
    .max(MAX_NOTE_LENGTH)
    .optional()
    .transform((v) => (v && v !== "" ? v : undefined));

export const lendEquipmentSchema = z
    .object({
        equipmentId: z.coerce.number().int().positive(),
        borrowerId: z.coerce.number().int().positive(),
        lentAt: requiredDateField,
        dueAt: optionalDateField,
        note: optionalNote,
    })
    .refine((data) => data.dueAt === undefined || Date.parse(data.dueAt) >= Date.parse(data.lentAt), {
        message: "La date d'échéance ne peut pas précéder la date de prêt.",
        path: ["dueAt"],
    });

export const returnLoanSchema = z.object({
    id: z.coerce.number().int().positive(),
    returnedAt: requiredDateField,
});

export const editLoanSchema = z.object({
    id: z.coerce.number().int().positive(),
    dueAt: optionalDateField,
    note: optionalNote,
});

export type LendEquipmentInput = z.infer<typeof lendEquipmentSchema>;
export type ReturnLoanInput = z.infer<typeof returnLoanSchema>;
export type EditLoanInput = z.infer<typeof editLoanSchema>;
