import z from "zod";
import { optionalJobFunctionId, clearable, MAX_NAME_LENGTH, MAX_EMAIL_LENGTH, MAX_PHONE_LENGTH } from "@/schemas/fields";

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

// UPDATE: absent = leave alone, blank/null = clear (email, phone, function),
// a value = set it — schemas/fields.ts, "Partial writes". `clientId` is not a
// written column here (a contact never changes company): it only travels for
// revalidatePath.
export const updateContactSchema = z.object({
    id: z.coerce.number().int().positive(),
    clientId: z.coerce.number().int().positive(),
    firstName: z.string().min(1, "Le prénom est requis").max(MAX_NAME_LENGTH).optional(),
    lastName: z.string().min(1, "Le nom est requis").max(MAX_NAME_LENGTH).optional(),
    email: clearable(z.string().max(MAX_EMAIL_LENGTH)),
    phone: clearable(z.string().max(MAX_PHONE_LENGTH)),
    jobFunctionId: optionalJobFunctionId,
});

export type UpdateContactInput = z.infer<typeof updateContactSchema>;
