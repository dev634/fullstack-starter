import { prisma } from "@/lib/prisma";

type ReservePlanData = {
    projectId: number;
    name: string;
    url: string;
    publicId: string;
    folderId?: number | null;
};

/** Plans of a project, oldest first, each with its pinned réserves. */
export async function findByProject(projectId: number) {
    try {
        return await prisma.reservePlan.findMany({
            where: { projectId },
            orderBy: { createdAt: "asc" },
            include: {
                reserves: {
                    orderBy: { createdAt: "asc" },
                    include: { photos: { orderBy: { createdAt: "asc" } } },
                },
            },
        });
    } catch (error) {
        console.log("Repository findByProject (reservePlan) error:", error);
        throw { type: "error", message: "Database Error fetching plans." };
    }
}

export async function findById(id: number) {
    try {
        return await prisma.reservePlan.findUnique({ where: { id } });
    } catch (error) {
        console.log("Repository findById (reservePlan) error:", error);
        throw { type: "error", message: "Database Error fetching plan." };
    }
}

export async function create(data: ReservePlanData) {
    try {
        return await prisma.reservePlan.create({ data: { ...data, folderId: data.folderId ?? null } });
    } catch (error) {
        console.log("Repository create (reservePlan) error:", error);
        throw { type: "error", message: "Database Error creating plan." };
    }
}

/**
 * Move a plan into a folder (or to the project root when `folderId` is null).
 * Scoped to `projectId`: the plan and, when set, the target folder must both
 * belong to it, so a stray id can't move another project's plan or file it
 * under a foreign folder.
 */
export async function setFolder(planId: number, folderId: number | null, projectId: number) {
    try {
        if (folderId != null) {
            const folder = await prisma.reservePlanFolder.findFirst({
                where: { id: folderId, projectId },
                select: { id: true },
            });
            if (!folder) throw { type: "error", message: "Folder not found in this project." };
        }
        return await prisma.reservePlan.updateMany({
            where: { id: planId, projectId },
            data: { folderId },
        });
    } catch (error) {
        console.log("Repository setFolder (reservePlan) error:", error);
        throw { type: "error", message: "Database Error moving plan." };
    }
}

/** Deletes a plan (cascades to its réserves) and returns it for asset cleanup. */
export async function remove(id: number) {
    try {
        return await prisma.reservePlan.delete({ where: { id } });
    } catch (error) {
        console.log("Repository remove (reservePlan) error:", error);
        throw { type: "error", message: "Database Error deleting plan." };
    }
}
