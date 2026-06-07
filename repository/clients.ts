import { prisma } from "@/lib/prisma";
import { type Client, Prisma } from "@/app/generated/prisma/client";
import { GetClientsByOrder } from "@/service/clients";



export async function create({firstName, lastName, email, companyName, address, city, zipCode, country}: Omit<Client, "id">) {
    try {
        const clients = await prisma.client.create({
            data: {
                firstName,
                lastName,
                email,
                companyName,
                address,
                city,
                zipCode,
                country
            }
        });
        return clients;
    } catch (error) {
        if(error instanceof Prisma.PrismaClientKnownRequestError ) {
            if (error.code === "P2002") {
                throw {
                    type: "databaseError",
                    message: "A client with this email already exists. Please use a different email."
                }
            }
        }
        
        throw {
            type: "error",
            message: "Database Error creating client."
        };
    }
}

export async function findAll(orderBy: GetClientsByOrder) {
    try {
        const clients = await prisma.client.findMany({orderBy: orderBy || { id: "asc" }});
        return clients;
    } catch (error) {
        console.log("Repository findAll error:", error);
        throw {
            type: "error",
            message: "Database Error fetching clients."
           }
    }
}

export async function findById(id: number) {
    try{
        const client = await prisma.client.findUnique({
             where: { id },
        });
        return client;
    }catch(error){
        console.log("Repository findById error:", error);
        throw {
            type: "error",
            message: "Database Error fetching client."
           }
    }
}

export async function update({ id, firstName, lastName, email, companyName, address, city, zipCode, country }: Client) {
    try{
        const client = await prisma.client.update({
            where: { id },
            data: { firstName, lastName, email, companyName, address, city, zipCode, country },
        });
        return client;
    }catch(error){
        console.log("Repository update error:", error);
        throw {
            type: "error",
            message: "Database Error update client"
        }
    }
}

export async function remove(id: number) {
    try{
    const client = await prisma.client.delete({
        where: { id },
    });
    return client;
    }catch(error){
        console.log("Repository delete error:", error);
        throw {
            type: "error",
            message: "Database Error deleting client"
        }
    }
}   