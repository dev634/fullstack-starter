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
                type: "validation_error",
                message: makeObjectFromZodError(parsedData.error)
            };
        }
    
        const client = await create(parsedData.data);
        console.log(client)
        return {
            type: "success",
            message: `Client added successfully!`
        }
    } catch (error) {
        if(error instanceof Prisma.PrismaClientKnownRequestError ) {
            console.log("Database error");
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
        console.log(error);
        throw {
            type: "error",
            message: "Server error fetching clients."
        }
    }
}