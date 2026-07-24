import { prisma } from "@/lib/prisma";

type ReservePlanData = {
    projectId: number;
    name: string;
    url: string;
    publicId: string;
};

/** Plans of a project, oldest first, each with its pinned réserves. */
export async function findByProject(projectId: number) {
    try {
        return await prisma.reservePlan.findMany({
            where: { projectId },
            orderBy: { createdAt: "asc" },
            include: { reserves: { orderBy: { createdAt: "asc" } } },
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
        return await prisma.reservePlan.create({ data });
    } catch (error) {
        console.log("Repository create (reservePlan) error:", error);
        throw { type: "error", message: "Database Error creating plan." };
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
