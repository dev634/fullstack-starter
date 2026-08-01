import { prisma } from "@/lib/prisma";

export async function create(data: { reserveId: number; url: string; publicId: string }) {
    try {
        return await prisma.reservePhoto.create({ data });
    } catch (error) {
        console.log("Repository create (reservePhoto) error:", error);
        throw { type: "error", message: "Database Error saving photo." };
    }
}

export async function findById(id: number) {
    try {
        return await prisma.reservePhoto.findUnique({ where: { id } });
    } catch (error) {
        console.log("Repository findById (reservePhoto) error:", error);
        throw { type: "error", message: "Database Error fetching photo." };
    }
}

/**
 * The photo's real project id (via its réserve — ReservePhoto has no
 * projectId column of its own), or null if it doesn't exist — see
 * repository/tasks.ts::findProjectId.
 */
export async function findProjectId(id: number): Promise<number | null> {
    try {
        const photo = await prisma.reservePhoto.findUnique({
            where: { id },
            select: { reserve: { select: { projectId: true } } },
        });
        return photo?.reserve.projectId ?? null;
    } catch (error) {
        console.log("Repository findProjectId (reservePhoto) error:", error);
        throw { type: "error", message: "Database Error fetching photo." };
    }
}

/** Deletes a photo row and returns it (for Cloudinary cleanup). */
export async function remove(id: number) {
    try {
        return await prisma.reservePhoto.delete({ where: { id } });
    } catch (error) {
        console.log("Repository remove (reservePhoto) error:", error);
        throw { type: "error", message: "Database Error deleting photo." };
    }
}
