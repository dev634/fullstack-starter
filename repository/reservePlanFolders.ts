import { prisma } from "@/lib/prisma";

/** Reserve-plan folders of a project, oldest first. */
export async function findByProject(projectId: number) {
    try {
        return await prisma.reservePlanFolder.findMany({
            where: { projectId },
            orderBy: { createdAt: "asc" },
        });
    } catch (error) {
        console.log("Repository findByProject (reservePlanFolder) error:", error);
        throw { type: "error", message: "Database Error fetching folders." };
    }
}

export async function create(data: { projectId: number; name: string }) {
    try {
        return await prisma.reservePlanFolder.create({ data });
    } catch (error) {
        console.log("Repository create (reservePlanFolder) error:", error);
        throw { type: "error", message: "Database Error creating folder." };
    }
}

/**
 * Deletes a folder scoped to its project; its plans fall back to the project
 * root (FK onDelete: SetNull). Scoping to `projectId` means a stray id can't
 * delete another project's folder.
 */
export async function remove(id: number, projectId: number) {
    try {
        const { count } = await prisma.reservePlanFolder.deleteMany({ where: { id, projectId } });
        if (count === 0) throw { type: "error", message: "Folder not found in this project." };
        return { id };
    } catch (error) {
        console.log("Repository remove (reservePlanFolder) error:", error);
        throw { type: "error", message: "Database Error deleting folder." };
    }
}
