import z from "zod";
import { optionalJobFunctionId, MAX_NAME_LENGTH, MAX_EMAIL_LENGTH, MAX_PHONE_LENGTH } from "@/schemas/fields";

// Adversarial pass 2, point 5: firstName/lastName/email/phone had no upper
// bound.
export const createContactSchema = z.object({
    clientId: z.coerce.number().int().positive(),
    firstName: z.string().min(1, "Le prénom est requis").max(MAX_NAME_LENGTH),
    lastName: z.string().min(1, "Le nom est requis").max(MAX_NAME_LENGTH),
    email: z.string().max(MAX_EMAIL_LENGTH).optional(),
    phone: z.string().max(MAX_PHONE_LENGTH).optional(),
    jobFunctionId: optionalJobFunctionId,
});

export type CreateContactInput = z.infer<typeof createContactSchema>;

export const updateContactSchema = createContactSchema.extend({
    id: z.coerce.number().int().positive(),
});

export type UpdateContactInput = z.infer<typeof updateContactSchema>;
