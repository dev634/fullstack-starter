import z from "zod";
import {
    MAX_NAME_LENGTH,
    MAX_LINE_LENGTH,
    MAX_CODE_LENGTH,
    MAX_EMAIL_LENGTH,
    MAX_URL_LENGTH,
    MAX_PHONE_LENGTH,
    clearable,
} from "@/schemas/fields";

export const clientStatusSchema = z.enum(["PROSPECT", "CLIENT", "INACTIVE"]);

// Adversarial pass 2, point 5: none of these fields had an upper bound
// before — companyName at 100 000 characters wrote successfully. See
// schemas/fields.ts for the tier constants and their rationale.
export const createClientSchema = z.object({
    email: z.string().email("Invalid email address").max(MAX_EMAIL_LENGTH),
    companyName: z.string().min(1, "Company name is required").max(MAX_NAME_LENGTH),
    address: z.string().min(1, "Address is required").max(MAX_LINE_LENGTH),
    city: z.string().min(1, "City is required").max(MAX_NAME_LENGTH),
    zipCode: z.string().min(1, "Zip code is required").max(MAX_CODE_LENGTH),
    country: z.string().min(1, "Country is required").max(MAX_NAME_LENGTH),
    phone: z.string().max(MAX_PHONE_LENGTH).optional(),
    website: z.string().max(MAX_URL_LENGTH).optional(),
    status: clientStatusSchema.default("PROSPECT"),
});
// UPDATE: every field optional (absent = leave alone), no `.default()` on
// `status` (an absent one used to put a CLIENT back to PROSPECT), and the two
// clearable fields resolve blank to null — schemas/fields.ts, "Partial
// writes". The required text fields keep their `min(1)`: sent blank, they are
// refused, not cleared.
export const updateClientSchema = z.object({
    // Comes from a hidden form field, i.e. a string — z.number() alone
    // rejected every real submission (see adversarial pass 2, point 1): this
    // schema was declared but never imported anywhere, so nothing caught it.
    id: z.coerce.number().int().positive(),
    email: z.string().email("Invalid email address").max(MAX_EMAIL_LENGTH).optional(),
    companyName: z.string().min(1, "Min 1 character").max(MAX_NAME_LENGTH).optional(),
    address: z.string().min(1, "Min 1 character").max(MAX_LINE_LENGTH).optional(),
    city: z.string().min(1, "Min 1 character").max(MAX_NAME_LENGTH).optional(),
    zipCode: z.string().min(1, "Min 1 character").max(MAX_CODE_LENGTH).optional(),
    country: z.string().min(1, "Min 1 character").max(MAX_NAME_LENGTH).optional(),
    phone: clearable(z.string().max(MAX_PHONE_LENGTH)),
    website: clearable(z.string().max(MAX_URL_LENGTH)),
    status: clientStatusSchema.optional(),
});


export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
