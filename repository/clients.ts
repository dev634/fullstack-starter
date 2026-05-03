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
    } finally { 
        await prisma.$disconnect();
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
    }finally{
        await prisma.$disconnect();
    }
}

export async function findById(id: number) {
    const client = await prisma.client.findUnique({
        where: { id },
    });
    await prisma.$disconnect();
    return client;
}

export async function update(id: number, data: Partial<Client>) {
    const client = await prisma.client.update({
        where: { id },
        data,
    });
    await prisma.$disconnect();
    return client;
}

export async function remove(id: number) {
    const client = await prisma.client.delete({
        where: { id },
    });
    await prisma.$disconnect();
    return client;
}   