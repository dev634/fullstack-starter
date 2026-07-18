import { prisma } from "@/lib/prisma";

type TaskData = {
    projectId: number;
    title: string;
    dueDate?: string;
    groupId?: number | null;
    quantityTarget?: number;
    categoryId?: number | null;
};

export async function create(data: TaskData) {
    try {
        return await prisma.projectTask.create({
            data: {
                projectId: data.projectId,
                title: data.title,
                dueDate: data.dueDate ? new Date(data.dueDate) : null,
                groupId: data.groupId ?? null,
                quantityTarget: data.quantityTarget ?? null,
                quantityDone: data.quantityTarget != null ? 0 : null,
                categoryId: data.categoryId ?? null,
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

/** Bulk-insert (e.g. a numbered series) in a single round trip. */
export async function createMany(items: TaskData[]) {
    try {
        return await prisma.projectTask.createMany({
            data: items.map((item) => ({
                projectId: item.projectId,
                title: item.title,
                dueDate: item.dueDate ? new Date(item.dueDate) : null,
                groupId: item.groupId ?? null,
            })),
        });
    } catch (error) {
        console.log("Repository createMany task error:", error);
        throw {
            type: "error",
            message: "Database Error creating tasks.",
        };
    }
}

/**
 * Ungrouped tasks for a project (tasks belonging to a named series are
 * fetched separately via repository/taskGroups and shown as one summarized
 * row) — unfinished first, oldest first within each group.
 */
export async function findByProject(projectId: number) {
    try {
        return await prisma.projectTask.findMany({
            where: { projectId, groupId: null },
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

/**
 * Updates a quantity-tracked task's progress, clamped to [0, quantityTarget]
 * — done is kept in sync (true once quantityDone reaches quantityTarget) so
 * every other view that reads task.done (progress bars, dashboards, sort
 * order) keeps working without special-casing quantity-tracked tasks.
 */
export async function updateQuantity(id: number, quantityDone: number) {
    try {
        const task = await prisma.projectTask.findUniqueOrThrow({ where: { id } });
        const target = task.quantityTarget ?? 0;
        const clamped = Math.max(0, Math.min(quantityDone, target));
        return await prisma.projectTask.update({
            where: { id },
            data: { quantityDone: clamped, done: target > 0 && clamped >= target },
        });
    } catch (error) {
        console.log("Repository updateQuantity task error:", error);
        throw {
            type: "error",
            message: "Database Error updating task.",
        };
    }
}

type TaskUpdateData = {
    title: string;
    dueDate?: string;
    quantityTarget?: number;
};

/**
 * Edits a task's own fields. Changing quantityTarget re-clamps the existing
 * quantityDone to the new target and keeps done in sync — same rule as
 * updateQuantity. Clearing quantityTarget entirely reverts the task to a
 * plain checkbox (done is left as-is; the admin can flip it manually).
 *
 * Newly turning ON quantity tracking (quantityTarget was null, now isn't)
 * starts from the task's current done state rather than always 0 — a task
 * that was already checked off shouldn't silently flip back to "not done"
 * with its progress wiped just because an admin gave it a target.
 */
export async function update(id: number, data: TaskUpdateData) {
    try {
        const current = await prisma.projectTask.findUniqueOrThrow({ where: { id } });
        const quantityTarget = data.quantityTarget ?? null;
        const baselineDone =
            current.quantityTarget != null ? (current.quantityDone ?? 0) : current.done ? (quantityTarget ?? 0) : 0;
        const quantityDone = quantityTarget != null ? Math.max(0, Math.min(baselineDone, quantityTarget)) : null;
        const done = quantityTarget != null ? quantityDone! >= quantityTarget : current.done;
        return await prisma.projectTask.update({
            where: { id },
            data: {
                title: data.title,
                dueDate: data.dueDate ? new Date(data.dueDate) : null,
                quantityTarget,
                quantityDone,
                done,
            },
        });
    } catch (error) {
        console.log("Repository update task error:", error);
        throw {
            type: "error",
            message: "Database Error updating task.",
        };
    }
}

/** Assigns (or clears, when categoryId is null) the category a standalone task belongs to. */
export async function setCategory(id: number, categoryId: number | null) {
    try {
        return await prisma.projectTask.update({ where: { id }, data: { categoryId } });
    } catch (error) {
        console.log("Repository setCategory (task) error:", error);
        throw {
            type: "error",
            message: "Database Error updating task category.",
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
