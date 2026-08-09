import { prisma } from "@/lib/prisma";
import { buildBreadcrumb } from "@/lib/breadcrumb";

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
            type: "repositoryError",
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
            type: "repositoryError",
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
            type: "repositoryError",
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
            type: "repositoryError",
            message: "Database Error fetching folder.",
        };
    }
}

/**
 * Ancestor chain from the root down to the given folder, for breadcrumb
 * display — scoped to `projectId`: a folder id belonging to another project
 * (or reached while walking up to one, defensively) yields an empty/
 * truncated chain instead of surfacing that project's folder names.
 */
export function getBreadcrumb(projectId: number, folderId: number | null) {
    // Shared walker — also gives this module the cycle bound it lacked before.
    return buildBreadcrumb(folderId, projectId, findById);
}

async function collectDescendantFolderIds(projectId: number, folderId: number): Promise<number[]> {
    // One flat query for the whole project's folder tree, then walk it in
    // memory — the previous version issued one findMany per folder in the
    // subtree (N+1 as the tree gets deep/wide).
    const all = await prisma.projectFolder.findMany({
        where: { projectId },
        select: { id: true, parentId: true },
    });

    const childrenByParent = new Map<number, number[]>();
    for (const folder of all) {
        if (folder.parentId === null) continue;
        const children = childrenByParent.get(folder.parentId);
        if (children) children.push(folder.id);
        else childrenByParent.set(folder.parentId, [folder.id]);
    }

    const ids: number[] = [folderId];
    const queue: number[] = [folderId];
    while (queue.length > 0) {
        const current = queue.shift();
        if (current === undefined) break;
        for (const childId of childrenByParent.get(current) ?? []) {
            ids.push(childId);
            queue.push(childId);
        }
    }
    return ids;
}

/**
 * publicIds (with the guarded deliveryType/resourceType, for the correct
 * Cloudinary `type` + resource_type) of every file nested anywhere under a
 * folder — used to clean up Cloudinary assets before the folder (and its DB
 * rows) cascade-delete. destroyProjectFile silently no-ops on a mismatched
 * `type`, so these columns — not mimeType — are what a destroy call needs.
 */
export async function collectDescendantFilePublicIds(projectId: number, folderId: number) {
    try {
        const folderIds = await collectDescendantFolderIds(projectId, folderId);
        return await prisma.projectFile.findMany({
            where: { folderId: { in: folderIds } },
            select: { publicId: true, deliveryType: true, resourceType: true },
        });
    } catch (error) {
        console.log("Repository collectDescendantFilePublicIds error:", error);
        throw {
            type: "repositoryError",
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
            type: "repositoryError",
            message: "Database Error deleting folder.",
        };
    }
}
