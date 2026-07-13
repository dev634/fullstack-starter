import { prisma } from "@/lib/prisma";

type FileData = {
    projectId: number;
    folderId?: number | null;
    name: string;
    url: string;
    publicId: string;
    size?: number;
    mimeType?: string;
};

export async function create(data: FileData) {
    try {
        return await prisma.projectFile.create({
            data: {
                projectId: data.projectId,
                folderId: data.folderId ?? null,
                name: data.name,
                url: data.url,
                publicId: data.publicId,
                size: data.size ?? null,
                mimeType: data.mimeType ?? null,
            },
        });
    } catch (error) {
        console.log("Repository create file error:", error);
        throw {
            type: "error",
            message: "Database Error creating file.",
        };
    }
}

/** Files directly inside a folder, or at the project root when `folderId` is null. */
export async function findByFolder(projectId: number, folderId: number | null) {
    try {
        return await prisma.projectFile.findMany({
            where: { projectId, folderId },
            orderBy: { name: "asc" },
        });
    } catch (error) {
        console.log("Repository findByFolder (file) error:", error);
        throw {
            type: "error",
            message: "Database Error fetching files.",
        };
    }
}

export async function findById(id: number) {
    try {
        return await prisma.projectFile.findUnique({ where: { id } });
    } catch (error) {
        console.log("Repository findById (file) error:", error);
        throw {
            type: "error",
            message: "Database Error fetching file.",
        };
    }
}

/**
 * publicIds (with mime type, for the correct Cloudinary resource_type) of
 * every file in a project — used to clean up Cloudinary assets before the
 * project (and its files, via cascade) are permanently deleted.
 */
export async function findPublicIdsByProject(projectId: number) {
    try {
        return await prisma.projectFile.findMany({
            where: { projectId },
            select: { publicId: true, mimeType: true },
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
            select: { publicId: true, mimeType: true },
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
