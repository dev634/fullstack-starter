import { prisma } from "@/lib/prisma";

type TaskData = {
    projectId: number;
    title: string;
    dueDate?: string;
};

export async function create(data: TaskData) {
    try {
        return await prisma.projectTask.create({
            data: {
                projectId: data.projectId,
                title: data.title,
                dueDate: data.dueDate ? new Date(data.dueDate) : null,
            },
        });
    } catch (error) {
        console.log("Repository create task error:", error);
        throw {
            type: "error",
            message: "Database Error creating task.",
        };
    }
}

/** Tasks for a project, unfinished first, oldest first within each group. */
export async function findByProject(projectId: number) {
    try {
        return await prisma.projectTask.findMany({
            where: { projectId },
            orderBy: [{ done: "asc" }, { createdAt: "asc" }],
        });
    } catch (error) {
        console.log("Repository findByProject (task) error:", error);
        throw {
            type: "error",
            message: "Database Error fetching tasks.",
        };
    }
}

export async function toggle(id: number, done: boolean) {
    try {
        return await prisma.projectTask.update({ where: { id }, data: { done } });
    } catch (error) {
        console.log("Repository toggle task error:", error);
        throw {
            type: "error",
            message: "Database Error updating task.",
        };
    }
}

export async function remove(id: number) {
    try {
        return await prisma.projectTask.delete({ where: { id } });
    } catch (error) {
        console.log("Repository remove task error:", error);
        throw {
            type: "error",
            message: "Database Error deleting task.",
        };
    }
}
