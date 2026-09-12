import { prisma } from "@/lib/prisma";

type MaterialCategoryData = {
    projectId: number;
    name: string;
};

export async function create(data: MaterialCategoryData) {
    try {
        return await prisma.projectMaterialCategory.create({
            data: {
                projectId: data.projectId,
                name: data.name,
            },
        });
    } catch (error) {
        console.log("Repository create material category error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error creating material category.",
        };
    }
}

/** Categories for a project, oldest first — used both to list them and to populate the material category picker. */
export async function findByProject(projectId: number) {
    try {
        return await prisma.projectMaterialCategory.findMany({
            where: { projectId },
            orderBy: { createdAt: "asc" },
        });
    } catch (error) {
        console.log("Repository findByProject (material category) error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error fetching material categories.",
        };
    }
}

/** The category's real project id, or null if it doesn't exist — see repository/tasks.ts::findProjectId. */
export async function findProjectId(id: number): Promise<number | null> {
    try {
        const category = await prisma.projectMaterialCategory.findUnique({ where: { id }, select: { projectId: true } });
        return category?.projectId ?? null;
    } catch (error) {
        console.log("Repository findProjectId (material category) error:", error);
        throw { type: "repositoryError", message: "Database Error fetching material category." };
    }
}

/** Renames a category — the only field it owns besides its project and id. */
export async function rename(id: number, name: string) {
    try {
        return await prisma.projectMaterialCategory.update({ where: { id }, data: { name } });
    } catch (error) {
        console.log("Repository rename material category error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error renaming material category.",
        };
    }
}

/**
 * Deletes the category and reports how many materials fall back to
 * "non classé" as a result. The materials themselves are never touched by
 * this function — the database FK (ON DELETE SET NULL, migration
 * 20260906120000) does the unfiling on its own the moment the row is
 * deleted. The count is taken BEFORE the delete, inside the same
 * transaction, purely to report a number that is guaranteed to match what
 * the delete actually does — the base loses nothing, only the filing does,
 * and the caller needs the true count to say so (see
 * actions/materialCategories/materialCategories.ts's deleteMaterialCategory).
 */
export async function remove(id: number): Promise<{ category: Awaited<ReturnType<typeof create>>; unfiledCount: number }> {
    try {
        return await prisma.$transaction(async (tx) => {
            const unfiledCount = await tx.projectMaterial.count({ where: { materialCategoryId: id } });
            const category = await tx.projectMaterialCategory.delete({ where: { id } });
            return { category, unfiledCount };
        });
    } catch (error) {
        console.log("Repository remove material category error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error deleting material category.",
        };
    }
}
