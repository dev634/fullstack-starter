import { prisma } from "@/lib/prisma";
import type { Client } from "@/app/generated/prisma/client";


export async function create({firstName, lastName, email, companyName, address, city, zipCode, country}: Omit<Client, "id">)      {
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
    await prisma.$disconnect();
    return clients;
}

export async function findAll(orderBy: keyof Client) {
    const clients = await prisma.client.findMany({
        orderBy: { [orderBy]: "asc" },
    });
    await prisma.$disconnect();
    return clients;
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