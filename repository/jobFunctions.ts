import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";

/** All job functions, in their manual (drag-and-drop) display order. */
export async function findAll() {
    try {
        return await prisma.jobFunction.findMany({ orderBy: [{ position: "asc" }, { name: "asc" }] });
    } catch (error) {
        console.log("Repository findAll (jobFunction) error:", error);
        throw { type: "error", message: "Database Error fetching functions." };
    }
}

export async function create(name: string) {
    try {
        // New functions go to the end of the list.
        const last = await prisma.jobFunction.findFirst({ orderBy: { position: "desc" }, select: { position: true } });
        const position = (last?.position ?? -1) + 1;
        return await prisma.jobFunction.create({ data: { name, position } });
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

/** Set the project-section keys hidden from users holding this function. */
export async function updateHiddenSections(id: number, hiddenSections: string[]) {
    try {
        return await prisma.jobFunction.update({ where: { id }, data: { hiddenSections } });
    } catch (error) {
        console.log("Repository updateHiddenSections (jobFunction) error:", error);
        throw { type: "error", message: "Database Error updating function sections." };
    }
}

/** Set the top-level app-area keys hidden from users holding this function. */
export async function updateHiddenAreas(id: number, hiddenAreas: string[]) {
    try {
        return await prisma.jobFunction.update({ where: { id }, data: { hiddenAreas } });
    } catch (error) {
        console.log("Repository updateHiddenAreas (jobFunction) error:", error);
        throw { type: "error", message: "Database Error updating function areas." };
    }
}

/** Set whether holders of this function see every project or only assigned ones. */
export async function updateProjectScope(id: number, projectScope: "ALL" | "ASSIGNED") {
    try {
        return await prisma.jobFunction.update({ where: { id }, data: { projectScope } });
    } catch (error) {
        console.log("Repository updateProjectScope error:", error);
        throw { type: "error", message: "Database Error updating project scope." };
    }
}

/** Persist a new order: each id's position becomes its index in the array. */
export async function reorder(orderedIds: number[]) {
    try {
        return await prisma.$transaction(
            orderedIds.map((id, index) => prisma.jobFunction.update({ where: { id }, data: { position: index } }))
        );
    } catch (error) {
        console.log("Repository reorder (jobFunction) error:", error);
        throw { type: "error", message: "Database Error reordering functions." };
    }
}
