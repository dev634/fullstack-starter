import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";

/** All job functions, alphabetically. */
export async function findAll() {
    try {
        return await prisma.jobFunction.findMany({ orderBy: { name: "asc" } });
    } catch (error) {
        console.log("Repository findAll (jobFunction) error:", error);
        throw { type: "error", message: "Database Error fetching functions." };
    }
}

export async function create(name: string) {
    try {
        return await prisma.jobFunction.create({ data: { name } });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            throw { type: "duplicate", message: "This function already exists." };
        }
        console.log("Repository create (jobFunction) error:", error);
        throw { type: "error", message: "Database Error creating function." };
    }
}

export async function remove(id: number) {
    try {
        return await prisma.jobFunction.delete({ where: { id } });
    } catch (error) {
        console.log("Repository remove (jobFunction) error:", error);
        throw { type: "error", message: "Database Error deleting function." };
    }
}
