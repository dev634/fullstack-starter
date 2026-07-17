import { prisma } from "@/lib/prisma";

type TaskCategoryData = {
    projectId: number;
    name: string;
};

export async function create(data: TaskCategoryData) {
    try {
        return await prisma.projectTaskCategory.create({
            data: {
                projectId: data.projectId,
                name: data.name,
            },
        });
    } catch (error) {
        console.log("Repository create task category error:", error);
        throw {
            type: "error",
            message: "Database Error creating task category.",
        };
    }
}

/** Categories for a project, oldest first — used both to list them and to populate the series picker. */
export async function findByProject(projectId: number) {
    try {
        return await prisma.projectTaskCategory.findMany({
            where: { projectId },
            orderBy: { createdAt: "asc" },
        });
    } catch (error) {
        console.log("Repository findByProject (task category) error:", error);
        throw {
            type: "error",
            message: "Database Error fetching task categories.",
        };
    }
}

/** Deletes the category only — its series are SetNull'd back to ungrouped, not deleted. */
export async function remove(id: number) {
    try {
        return await prisma.projectTaskCategory.delete({ where: { id } });
    } catch (error) {
        console.log("Repository remove task category error:", error);
        throw {
            type: "error",
            message: "Database Error deleting task category.",
        };
    }
}
