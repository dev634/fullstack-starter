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

/** Deletes a photo row and returns it (for Cloudinary cleanup). */
export async function remove(id: number) {
    try {
        return await prisma.reservePhoto.delete({ where: { id } });
    } catch (error) {
        console.log("Repository remove (reservePhoto) error:", error);
        throw { type: "error", message: "Database Error deleting photo." };
    }
}
