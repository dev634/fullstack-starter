import { prisma } from "@/lib/prisma";

type Client = {
    id: number;
    firstName: string;
    lastName: string;
    email: string;
    companyName: string;
    address: string;
    city: string;
    zipCode: string;
    country: string;
}



export async function create({firstName, lastName, email, companyName, address, city, zipCode, country}:Client){
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

export async function findAll(ordeyBy: "companyName" | "firstName" = "companyName") {
    const clients = await prisma.client.findMany({
        orderBy: { [ordeyBy]: "asc" },
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