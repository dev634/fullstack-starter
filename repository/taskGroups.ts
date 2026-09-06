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
            type: "repositoryError",
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
            type: "repositoryError",
            message: "Database Error fetching task groups.",
        };
    }
}

export type TaskGroupLinkOption = { id: number; name: string };

/**
 * Just id + name of every série in a project — for the material-link picker
 * (forms/AddMaterialForm.tsx's MaterialLinkOption) on the project hub, which
 * never reads a group's tasks, counts or assignee to populate a `<select>`.
 * Avoids the nested `include: { tasks: ... }` findByProject (above) needs
 * for its own callers, same reasoning as repository/tasks.ts::findLinkOptions.
 */
export async function findLinkOptions(projectId: number): Promise<TaskGroupLinkOption[]> {
    try {
        return await prisma.projectTaskGroup.findMany({
            where: { projectId },
            select: { id: true, name: true },
            orderBy: { id: "asc" },
        });
    } catch (error) {
        console.log("Repository findLinkOptions (task group) error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error fetching task group link options.",
        };
    }
}

/** The group's real project id, or null if it doesn't exist — see repository/tasks.ts::findProjectId. */
export async function findProjectId(id: number): Promise<number | null> {
    try {
        const group = await prisma.projectTaskGroup.findUnique({ where: { id }, select: { projectId: true } });
        return group?.projectId ?? null;
    } catch (error) {
        console.log("Repository findProjectId (task group) error:", error);
        throw { type: "repositoryError", message: "Database Error fetching task group." };
    }
}

/** Assigns (or clears, when categoryId is null) the category an existing series belongs to. */
export async function setCategory(id: number, categoryId: number | null) {
    try {
        return await prisma.projectTaskGroup.update({ where: { id }, data: { categoryId } });
    } catch (error) {
        console.log("Repository setCategory (task group) error:", error);
        throw {
            type: "repositoryError",
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
            type: "repositoryError",
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
            type: "repositoryError",
            message: "Database Error deleting task group.",
        };
    }
}
