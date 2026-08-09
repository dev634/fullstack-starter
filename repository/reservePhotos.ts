import { prisma } from "@/lib/prisma";
import type { CloudinaryDeliveryType, CloudinaryResourceType } from "@/app/generated/prisma/client";

type ReservePhotoData = {
    reserveId: number;
    // DEPRECATED — see ProjectFile.url's doc (prisma/schema.prisma). Still
    // written, never read back.
    url: string;
    publicId: string;
    deliveryType: CloudinaryDeliveryType;
    resourceType: CloudinaryResourceType;
    format?: string | null;
    version?: string | null;
};

/**
 * The created row is returned as `data` by addReservePhoto straight to
 * ReservesSection (a Client Component) — `url` is omitted from what comes
 * back so that response never carries it, even though the column is still
 * written (see ReservePhotoData.url's doc above).
 */
export async function create(data: ReservePhotoData) {
    try {
        return await prisma.reservePhoto.create({
            data: {
                reserveId: data.reserveId,
                url: data.url,
                publicId: data.publicId,
                deliveryType: data.deliveryType,
                resourceType: data.resourceType,
                format: data.format ?? null,
                version: data.version ?? null,
            },
            omit: { url: true },
        });
    } catch (error) {
        console.log("Repository create (reservePhoto) error:", error);
        throw { type: "repositoryError", message: "Database Error saving photo." };
    }
}

/**
 * `url` is omitted here too — used by the deletion action (which only needs
 * publicId/deliveryType/resourceType for the Cloudinary destroy call) — see
 * ProjectFile.url's doc in prisma/schema.prisma for why the column must
 * never travel further than it has to. The guarded delivery route does NOT
 * use this — see findByIdWithProjectId below, which it needs instead.
 */
export async function findById(id: number) {
    try {
        return await prisma.reservePhoto.findUnique({ where: { id }, omit: { url: true } });
    } catch (error) {
        console.log("Repository findById (reservePhoto) error:", error);
        throw { type: "repositoryError", message: "Database Error fetching photo." };
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
        throw { type: "repositoryError", message: "Database Error fetching photo." };
    }
}

/**
 * The photo plus its project id (via its réserve — see findProjectId's doc
 * for why that hop is needed at all), in a single query. Used by the guarded
 * delivery route, which previously issued findById + findProjectId as two
 * separate reads of the very same row on every request. `url` is omitted
 * for the same reason as findById above.
 */
export async function findByIdWithProjectId(id: number) {
    try {
        return await prisma.reservePhoto.findUnique({
            where: { id },
            omit: { url: true },
            include: { reserve: { select: { projectId: true } } },
        });
    } catch (error) {
        console.log("Repository findByIdWithProjectId (reservePhoto) error:", error);
        throw { type: "repositoryError", message: "Database Error fetching photo." };
    }
}

/**
 * Deletes a photo row and returns it — deleteReservePhoto uses a row fetched
 * separately (`findById`, before the delete) for the actual Cloudinary
 * cleanup, and only forwards THIS return value as `data` in its response to
 * the client, so `url` is omitted here too.
 */
export async function remove(id: number) {
    try {
        return await prisma.reservePhoto.delete({ where: { id }, omit: { url: true } });
    } catch (error) {
        console.log("Repository remove (reservePhoto) error:", error);
        throw { type: "repositoryError", message: "Database Error deleting photo." };
    }
}
