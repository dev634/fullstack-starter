import { Prisma } from "@/app/generated/prisma/client";
import { create } from "@/repository/clients";
import {z}  from "zod";

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

export async function createClient(data: CreateClientInput) {
    try {
    createClientSchema.parse(data);
    const client = await create(data);
    console.log(client)
    return {
        type: "success",
        message: `Client added successfully!`
    }
    } catch (error) {
        
        if(error instanceof z.ZodError) {
            console.error("Validation Error creating client:", error);
            throw {
                type: "zodError",
                message: "Invalid client data."
            };
        }

        if(error instanceof Prisma.PrismaClientKnownRequestError ) {
            console.error("Service Error creating client:", error.message);
            throw{
                type: "error",
                message: "Database error adding client."
            };
        }

        return {
            type: "error",
            message: "Error adding client."
        }
    }
}   