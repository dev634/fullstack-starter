import z from "zod";

export const clientStatusSchema = z.enum(["PROSPECT", "CLIENT", "INACTIVE"]);

export const createClientSchema = z.object({
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().min(1, "Last name is required"),
    email: z.string().email("Invalid email address"),
    companyName: z.string().min(1, "Company name is required"),
    address: z.string().min(1, "Address is required"),
    city: z.string().min(1, "City is required"),
    zipCode: z.string().min(1, "Zip code is required"),
    country: z.string().min(1, "Country is required"),
    phone: z.string().optional(),
    website: z.string().optional(),
    status: clientStatusSchema.default("PROSPECT"),
});
export const updateClientSchema = z.object({
    id: z.number(),
    firstName: z.string().min(1, "Min 1 character"),
    lastName: z.string().min(1, "Min 1 character"),
    email: z.string().email("Invalid email address"),
    companyName: z.string().min(1, "Min 1 character"),
    address: z.string().min(1, "Min 1 character"),
    city: z.string().min(1, "Min 1 character"),
    zipCode: z.string().min(1, "Min 1 character"),
    country: z.string().min(1, "Min 1 character"),
    phone: z.string().optional(),
    website: z.string().optional(),
    status: clientStatusSchema.default("PROSPECT"),
});


export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;