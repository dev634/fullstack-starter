import { prisma } from "@/lib/prisma";
import type { CloudinaryDeliveryType, CloudinaryResourceType } from "@/app/generated/prisma/client";

type FileData = {
    projectId: number;
    folderId?: number | null;
    name: string;
    // DEPRECATED — the legacy public secure_url. Still written (the column
    // stays NOT NULL for one release so this change stays revertible), but
    // nothing may read it back: see ProjectFile.url's doc in
    // prisma/schema.prisma. The delivery route rebuilds the URL from
    // publicId + resourceType + format + version instead.
    url: string;
    publicId: string;
    deliveryType: CloudinaryDeliveryType;
    resourceType: CloudinaryResourceType;
    format?: string | null;
    version?: string | null;
    size?: number;
    mimeType?: string;
};

/**
 * The created row is returned as `data` by both callers (uploadFile,
 * deliveryNoteScan's archive step) straight to a Client Component — `url` is
 * omitted from what comes back so that response never carries it, even
 * though the column is still written (see FileData.url's doc above).
 */
export async function create(data: FileData) {
    try {
        return await prisma.projectFile.create({
            data: {
                projectId: data.projectId,
                folderId: data.folderId ?? null,
                name: data.name,
                url: data.url,
                publicId: data.publicId,
                deliveryType: data.deliveryType,
                resourceType: data.resourceType,
                format: data.format ?? null,
                version: data.version ?? null,
                size: data.size ?? null,
                mimeType: data.mimeType ?? null,
            },
            omit: { url: true },
        });
    } catch (error) {
        console.log("Repository create file error:", error);
        throw {
            type: "error",
            message: "Database Error creating file.",
        };
    }
}

/**
 * Files directly inside a folder, or at the project root when `folderId` is
 * null — what the project page passes straight into ProjectFileRow (a Client
 * Component), so `url` is omitted here: a Client Component's props are
 * serialized into the page's HTML, and the deprecated column would reach the
 * browser exactly like a rendered value would (see ProjectFile.url's doc in
 * prisma/schema.prisma). The row's id is enough — ProjectFileRow builds the
 * guarded delivery path from it (lib/assetPath.ts).
 */
export async function findByFolder(projectId: number, folderId: number | null) {
    try {
        return await prisma.projectFile.findMany({
            where: { projectId, folderId },
            orderBy: { name: "asc" },
            omit: { url: true },
        });
    } catch (error) {
        console.log("Repository findByFolder (file) error:", error);
        throw {
            type: "error",
            message: "Database Error fetching files.",
        };
    }
}

/**
 * `url` is omitted here too — used by the guarded delivery route (which
 * signs its own URL from publicId + the guarded columns, never reads it
 * back) and by deleteFile (which only needs publicId/deliveryType/
 * resourceType for the Cloudinary destroy call) — see ProjectFile.url's doc
 * in prisma/schema.prisma for why the column must never travel further than
 * it has to.
 */
export async function findById(id: number) {
    try {
        return await prisma.projectFile.findUnique({ where: { id }, omit: { url: true } });
    } catch (error) {
        console.log("Repository findById (file) error:", error);
        throw {
            type: "error",
            message: "Database Error fetching file.",
        };
    }
}

/**
 * publicIds (with the guarded deliveryType/resourceType, for the correct
 * Cloudinary `type` + resource_type) of every file in a project — used to
 * clean up Cloudinary assets before the project (and its files, via cascade)
 * are permanently deleted. destroyProjectFile silently no-ops on a mismatched
 * `type`, so these columns — not mimeType — are what a destroy call needs.
 */
export async function findPublicIdsByProject(projectId: number) {
    try {
        return await prisma.projectFile.findMany({
            where: { projectId },
            select: { publicId: true, deliveryType: true, resourceType: true },
        });
    } catch (error) {
        console.log("Repository findPublicIdsByProject error:", error);
        throw {
            type: "error",
            message: "Database Error collecting project files.",
        };
    }
}

/**
 * Same as findPublicIdsByProject but for every file across all of a client's
 * projects — used before permanently deleting a client cascades everything.
 */
export async function findPublicIdsByClient(clientId: number) {
    try {
        return await prisma.projectFile.findMany({
            where: { project: { clientId } },
            select: { publicId: true, deliveryType: true, resourceType: true },
        });
    } catch (error) {
        console.log("Repository findPublicIdsByClient error:", error);
        throw {
            type: "error",
            message: "Database Error collecting client files.",
        };
    }
}

export async function remove(id: number) {
    try {
        return await prisma.projectFile.delete({ where: { id } });
    } catch (error) {
        console.log("Repository remove file error:", error);
        throw {
            type: "error",
            message: "Database Error deleting file.",
        };
    }
}
