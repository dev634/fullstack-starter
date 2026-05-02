import { Prisma } from "@/app/generated/prisma/client";
import { makeObjectFromZodError } from "@/lib/zod";
import { create } from "@/repository/clients";
import { CreateClientInput, createClientSchema } from "@/schemas/client";
import {z}  from "zod";




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
            throw {
                type: "zodError",
                message: makeObjectFromZodError(error)
            };
        }

        if(error instanceof Prisma.PrismaClientKnownRequestError ) {
            console.log("Database error");
        }

        throw {
            type: "error",
            message: "Server error adding client."
        }
    }
}   