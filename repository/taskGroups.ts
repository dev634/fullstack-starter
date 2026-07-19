import { prisma } from "@/lib/prisma";

type TaskGroupData = {
    projectId: number;
    name: string;
    pattern: string;
    categoryId?: number | null;
};

export async function create(data: TaskGroupData) {
    try {
        return await prisma.projectTaskGroup.create({
            data: {
                projectId: data.projectId,
                name: data.name,
                pattern: data.pattern,
                categoryId: data.categoryId ?? null,
            },
        });
    } catch (error) {
        console.log("Repository create task group error:", error);
        throw {
            type: "error",
            message: "Database Error creating task group.",
        };
    }
}

/**
 * Task-series groups for a project, with their done/total task counts and
 * full task list — the list is rendered inline in a collapsible dropdown
 * rather than on a separate page, so it's fetched up front here. Unfinished
 * first, oldest first within each group, matching the plain task ordering.
 */
export async function findByProject(projectId: number) {
    try {
        const groups = await prisma.projectTaskGroup.findMany({
            where: { projectId },
            include: { tasks: { orderBy: [{ done: "asc" }, { createdAt: "asc" }] } },
        });
        return groups.map((group) => ({
            id: group.id,
            projectId: group.projectId,
            name: group.name,
            pattern: group.pattern,
            createdAt: group.createdAt,
            categoryId: group.categoryId,
            assignedCompanyId: group.assignedCompanyId,
            assignedInterimId: group.assignedInterimId,
            tasks: group.tasks,
            totalCount: group.tasks.length,
            doneCount: group.tasks.filter((t) => t.done).length,
        }));
    } catch (error) {
        console.log("Repository findByProject (task group) error:", error);
        throw {
            type: "error",
            message: "Database Error fetching task groups.",
        };
    }
}

/** Assigns (or clears, when categoryId is null) the category an existing series belongs to. */
export async function setCategory(id: number, categoryId: number | null) {
    try {
        return await prisma.projectTaskGroup.update({ where: { id }, data: { categoryId } });
    } catch (error) {
        console.log("Repository setCategory (task group) error:", error);
        throw {
            type: "error",
            message: "Database Error updating task group category.",
        };
    }
}

/** Sets a series' assignee (subcontractor company OR intérimaire). */
export async function setAssignee(id: number, data: { assignedCompanyId: number | null; assignedInterimId: number | null }) {
    try {
        return await prisma.projectTaskGroup.update({
            where: { id },
            data: { assignedCompanyId: data.assignedCompanyId, assignedInterimId: data.assignedInterimId },
        });
    } catch (error) {
        console.log("Repository setAssignee (task group) error:", error);
        throw {
            type: "error",
            message: "Database Error updating task group assignee.",
        };
    }
}

/** Deletes the group and, via cascade, every task in it. */
export async function remove(id: number) {
    try {
        return await prisma.projectTaskGroup.delete({ where: { id } });
    } catch (error) {
        console.log("Repository remove task group error:", error);
        throw {
            type: "error",
            message: "Database Error deleting task group.",
        };
    }
}
