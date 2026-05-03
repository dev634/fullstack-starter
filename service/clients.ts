import { Prisma } from "@/app/generated/prisma/client";
import { makeObjectFromZodError } from "@/lib/zod";
import { create, findAll } from "@/repository/clients";
import { CreateClientInput, createClientSchema } from "@/schemas/client";



type OneKeyOnly<T> = {
  [K in keyof T]: {
    [P in K]: T[P]
  } & {
    [P in Exclude<keyof T, K>]?: never
  }
}[keyof T] extends infer O
  ? { [K in keyof O]: O[K] }
  : never

type OrderEnum = "asc" | "desc";
export type GetClientsByOrder = OneKeyOnly<Record<keyof CreateClientInput, OrderEnum>>

export async function createClient(data: CreateClientInput) {
    try {
        const parsedData = createClientSchema.safeParse(data);
    
        if (!parsedData.success) {
            throw {
                type: "zodError",
                message: "Validation error. Please check your input and try again.",
                fieldsForm: makeObjectFromZodError(parsedData.error)
            };
        }
    
        const client = await create(parsedData.data);
        return {
            type: "success",
            message: `Client added successfully!`
        }

    } catch (error) {
        console.log(error)
        if(error instanceof Prisma.PrismaClientKnownRequestError ) {
            if(error.code === "P2002") {
                throw {
                    type: "error",
                    message: "A client with this email already exists. Please use a different email."
                }
            }
        }

        if (error && typeof error === "object" && "type" in error && (error.type === "zodError" || error.type === "databaseError")) {
            throw error;
        }

        throw {
            type: "error",
            message: "Server error adding client."
        }
    }
}

export async function getClients(orderBy: GetClientsByOrder) {
    try {
        const clients = await findAll(orderBy);
        return clients;
    } catch (error) {
        throw {
            type: "error",
            message: "Server error fetching clients."
        }
    }
}