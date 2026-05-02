import z from "zod";

export const createClientSchema = z.object({
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().min(1, "Last name is required"),
    email: z.string().email("Invalid email address"),
    companyName: z.string().min(1, "Company name is required"),
    address: z.string().min(1, "Address is required"),  
    city: z.string().min(1, "City is required"),
    zipCode: z.string().min(1, "Zip code is required"),
    country: z.string().min(1, "Country is required"),
});

export type CreateClientInput = z.infer<typeof createClientSchema>;