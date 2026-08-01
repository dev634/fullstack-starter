import { prisma } from "@/lib/prisma";

/** Reserve-plan folders of a project, oldest first. */
export async function findByProject(projectId: number) {
    try {
        return await prisma.reservePlanFolder.findMany({
            where: { projectId },
            orderBy: { createdAt: "asc" },
        });
    } catch (error) {
        console.log("Repository findByProject (reservePlanFolder) error:", error);
        throw { type: "error", message: "Database Error fetching folders." };
    }
}

/** The folder's real project id, or null if it doesn't exist — see repository/tasks.ts::findProjectId. */
export async function findProjectId(id: number): Promise<number | null> {
    try {
        const folder = await prisma.reservePlanFolder.findUnique({ where: { id }, select: { projectId: true } });
        return folder?.projectId ?? null;
    } catch (error) {
        console.log("Repository findProjectId (reservePlanFolder) error:", error);
        throw { type: "error", message: "Database Error fetching folder." };
    }
}

/** Direct child folders of `parentId` (null = project root), like the Files module. */
export async function findChildren(projectId: number, parentId: number | null) {
    try {
        return await prisma.reservePlanFolder.findMany({
            where: { projectId, parentId },
            orderBy: { name: "asc" },
        });
    } catch (error) {
        console.log("Repository findChildren (reservePlanFolder) error:", error);
        throw { type: "error", message: "Database Error fetching folders." };
    }
}

export async function findById(id: number) {
    try {
        return await prisma.reservePlanFolder.findUnique({ where: { id } });
    } catch (error) {
        console.log("Repository findById (reservePlanFolder) error:", error);
        throw { type: "error", message: "Database Error fetching folder." };
    }
}

/** Root→current chain for the breadcrumb; walks `parentId` up to the root. */
export async function getBreadcrumb(folderId: number | null): Promise<{ id: number; name: string }[]> {
    const chain: { id: number; name: string }[] = [];
    let current = folderId;
    // Bounded so a corrupt parent cycle can't loop forever.
    for (let hops = 0; current != null && hops < 100; hops++) {
        const folder = await findById(current);
        if (!folder) break;
        chain.unshift({ id: folder.id, name: folder.name });
        current = folder.parentId;
    }
    return chain;
}

export async function create(data: { projectId: number; name: string; parentId?: number | null }) {
    try {
        return await prisma.reservePlanFolder.create({
            data: { projectId: data.projectId, name: data.name, parentId: data.parentId ?? null },
        });
    } catch (error) {
        console.log("Repository create (reservePlanFolder) error:", error);
        throw { type: "error", message: "Database Error creating folder." };
    }
}

/**
 * Deletes a folder scoped to its project; its plans fall back to the project
 * root (FK onDelete: SetNull). Scoping to `projectId` means a stray id can't
 * delete another project's folder.
 */
export async function remove(id: number, projectId: number) {
    try {
        const { count } = await prisma.reservePlanFolder.deleteMany({ where: { id, projectId } });
        if (count === 0) throw { type: "error", message: "Folder not found in this project." };
        return { id };
    } catch (error) {
        console.log("Repository remove (reservePlanFolder) error:", error);
        throw { type: "error", message: "Database Error deleting folder." };
    }
}
