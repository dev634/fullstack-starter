import { prisma } from "@/lib/prisma";

type FolderData = {
    projectId: number;
    name: string;
    parentId?: number | null;
};

/** Standard root folders every new project should start with. */
export const DEFAULT_FOLDER_NAMES = ["Plans", "Vgp", "Pvisotestes", "Bulletins de livraisons"];

export async function createDefaults(projectId: number) {
    try {
        return await prisma.projectFolder.createMany({
            data: DEFAULT_FOLDER_NAMES.map((name) => ({ projectId, name, parentId: null })),
        });
    } catch (error) {
        console.log("Repository createDefaults (folder) error:", error);
        throw {
            type: "error",
            message: "Database Error creating default folders.",
        };
    }
}

export async function create(data: FolderData) {
    try {
        return await prisma.projectFolder.create({
            data: {
                projectId: data.projectId,
                name: data.name,
                parentId: data.parentId ?? null,
            },
        });
    } catch (error) {
        console.log("Repository create folder error:", error);
        throw {
            type: "error",
            message: "Database Error creating folder.",
        };
    }
}

/** Direct child folders of a folder, or the root folders when `parentId` is null. */
export async function findChildren(projectId: number, parentId: number | null) {
    try {
        return await prisma.projectFolder.findMany({
            where: { projectId, parentId },
            orderBy: { name: "asc" },
        });
    } catch (error) {
        console.log("Repository findChildren (folder) error:", error);
        throw {
            type: "error",
            message: "Database Error fetching folders.",
        };
    }
}

export async function findById(id: number) {
    try {
        return await prisma.projectFolder.findUnique({ where: { id } });
    } catch (error) {
        console.log("Repository findById (folder) error:", error);
        throw {
            type: "error",
            message: "Database Error fetching folder.",
        };
    }
}

/** Ancestor chain from the root down to the given folder, for breadcrumb display. */
export async function getBreadcrumb(folderId: number | null): Promise<{ id: number; name: string }[]> {
    const chain: { id: number; name: string }[] = [];
    let current = folderId;
    while (current != null) {
        const folder = await findById(current);
        if (!folder) break;
        chain.unshift({ id: folder.id, name: folder.name });
        current = folder.parentId;
    }
    return chain;
}

async function collectDescendantFolderIds(projectId: number, folderId: number): Promise<number[]> {
    const children = await prisma.projectFolder.findMany({
        where: { projectId, parentId: folderId },
        select: { id: true },
    });
    const nested = await Promise.all(
        children.map((child) => collectDescendantFolderIds(projectId, child.id))
    );
    return [folderId, ...nested.flat()];
}

/**
 * publicIds (with mime type, for correct Cloudinary resource_type) of every
 * file nested anywhere under a folder — used to clean up Cloudinary assets
 * before the folder (and its DB rows) cascade-delete.
 */
export async function collectDescendantFilePublicIds(projectId: number, folderId: number) {
    try {
        const folderIds = await collectDescendantFolderIds(projectId, folderId);
        return await prisma.projectFile.findMany({
            where: { folderId: { in: folderIds } },
            select: { publicId: true, mimeType: true },
        });
    } catch (error) {
        console.log("Repository collectDescendantFilePublicIds error:", error);
        throw {
            type: "error",
            message: "Database Error collecting folder files.",
        };
    }
}

export async function remove(id: number) {
    try {
        return await prisma.projectFolder.delete({ where: { id } });
    } catch (error) {
        console.log("Repository remove folder error:", error);
        throw {
            type: "error",
            message: "Database Error deleting folder.",
        };
    }
}
