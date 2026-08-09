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
            type: "repositoryError",
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
            type: "repositoryError",
            message: "Database Error fetching task categories.",
        };
    }
}

/** The category's real project id, or null if it doesn't exist — see repository/tasks.ts::findProjectId. */
export async function findProjectId(id: number): Promise<number | null> {
    try {
        const category = await prisma.projectTaskCategory.findUnique({ where: { id }, select: { projectId: true } });
        return category?.projectId ?? null;
    } catch (error) {
        console.log("Repository findProjectId (task category) error:", error);
        throw { type: "repositoryError", message: "Database Error fetching task category." };
    }
}

/** Sets a category's assignee (subcontractor company OR intérimaire). */
export async function setAssignee(id: number, data: { assignedCompanyId: number | null; assignedInterimId: number | null }) {
    try {
        return await prisma.projectTaskCategory.update({
            where: { id },
            data: { assignedCompanyId: data.assignedCompanyId, assignedInterimId: data.assignedInterimId },
        });
    } catch (error) {
        console.log("Repository setAssignee (task category) error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error updating task category assignee.",
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
            type: "repositoryError",
            message: "Database Error deleting task category.",
        };
    }
}
