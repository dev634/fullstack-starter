import { prisma } from "@/lib/prisma";
import type { CloudinaryDeliveryType, CloudinaryResourceType } from "@/app/generated/prisma/client";

type ReservePlanData = {
    projectId: number;
    name: string;
    // DEPRECATED — see ProjectFile.url's doc (prisma/schema.prisma). Still
    // written, never read back.
    url: string;
    publicId: string;
    deliveryType: CloudinaryDeliveryType;
    resourceType: CloudinaryResourceType;
    format?: string | null;
    version?: string | null;
    folderId?: number | null;
};

/**
 * Plans of a project, oldest first, each with its pinned réserves. Consumed
 * both by the project page (which passes it straight into ReservesSection, a
 * Client Component) and by the réserves report route (server-only). `url` is
 * omitted at both levels (plan + nested photo) so it never ends up in a
 * Client Component's serialized props — see ProjectFile.url's doc in
 * prisma/schema.prisma. The report route never read it either way (it signs
 * its own delivery URLs from publicId + the guarded columns).
 */
export async function findByProject(projectId: number) {
    try {
        return await prisma.reservePlan.findMany({
            where: { projectId },
            orderBy: { createdAt: "asc" },
            omit: { url: true },
            include: {
                reserves: {
                    orderBy: { createdAt: "asc" },
                    include: { photos: { orderBy: { createdAt: "asc" }, omit: { url: true } } },
                },
            },
        });
    } catch (error) {
        console.log("Repository findByProject (reservePlan) error:", error);
        throw { type: "error", message: "Database Error fetching plans." };
    }
}

/**
 * `url` is omitted here too — used by the guarded delivery route (which
 * signs its own URL from publicId + the guarded columns, never reads it
 * back) and by the plan mutations (which only need publicId/deliveryType/
 * resourceType/projectId) — see ProjectFile.url's doc in
 * prisma/schema.prisma for why the column must never travel further than it
 * has to.
 */
export async function findById(id: number) {
    try {
        return await prisma.reservePlan.findUnique({ where: { id }, omit: { url: true } });
    } catch (error) {
        console.log("Repository findById (reservePlan) error:", error);
        throw { type: "error", message: "Database Error fetching plan." };
    }
}

/**
 * The created row is returned as `data` by addReservePlan straight to a
 * Client Component (AddReservePlanForm) — `url` is omitted from what comes
 * back so that response never carries it, even though the column is still
 * written (see ReservePlanData.url's doc above).
 */
export async function create(data: ReservePlanData) {
    try {
        return await prisma.reservePlan.create({
            data: {
                projectId: data.projectId,
                name: data.name,
                url: data.url,
                publicId: data.publicId,
                deliveryType: data.deliveryType,
                resourceType: data.resourceType,
                format: data.format ?? null,
                version: data.version ?? null,
                folderId: data.folderId ?? null,
            },
            omit: { url: true },
        });
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

/**
 * Deletes a plan (cascades to its réserves) and returns it — deleteReservePlan
 * uses a row fetched separately (`findById`, before the delete) for the
 * actual Cloudinary cleanup, and only forwards THIS return value as `data` in
 * its response to the client, so `url` is omitted here too.
 */
export async function remove(id: number) {
    try {
        return await prisma.reservePlan.delete({ where: { id }, omit: { url: true } });
    } catch (error) {
        console.log("Repository remove (reservePlan) error:", error);
        throw { type: "error", message: "Database Error deleting plan." };
    }
}
