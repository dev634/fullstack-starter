import { prisma } from "@/lib/prisma";
import { roundPercent } from "@/lib/projectDashboard";

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
            type: "repositoryError",
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
            type: "repositoryError",
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
            type: "repositoryError",
            message: "Database Error fetching tasks.",
        };
    }
}

export type TaskProgressTally = { done: number; total: number; percent: number };

/**
 * The exact {done, total, percent} lib/projectDashboard.ts::computeTaskProgress
 * would return for this project — WITHOUT loading a single ProjectTask or
 * ProjectTaskGroup row, for the project hub, which only ever renders these
 * three numbers (never the per-série `groups` breakdown computeTaskProgress
 * also computes; the dedicated tasks page still loads the real rows for
 * that). Verified byte-for-byte against computeTaskProgress on a real
 * project (10/28, 99.63%) before this function existed — see the PR that
 * introduced it.
 *
 * Weighting rule, mirrored from lib/projectDashboard.ts::computeTaskBarStats:
 * a STANDALONE task (groupId IS NULL) counts for its quantityTarget when it
 * has an active one (> 0), else a plain 1. A task that belongs to a series
 * (groupId IS NOT NULL) always counts as a plain 1 whether done or not —
 * because ProjectTaskGroup.doneCount/totalCount (repository/taskGroups.ts::
 * findByProject) are themselves plain boolean counts, never weighted by
 * quantity. In practice this never actually diverges: series tasks are
 * bulk-created without a quantityTarget (createMany, above, drops it) — but
 * the SQL below matches computeTaskProgress's actual JS behaviour rather
 * than that data-shape coincidence, so it can't silently drift from it if
 * that ever changes.
 *
 * LEAST/GREATEST reproduce computeTaskBarStats's own clamp
 * (min(target, max(0, quantityDone))) instead of trusting a stored
 * quantityDone is already in range — same defensive posture as the
 * function this mirrors.
 */
export async function computeProgressByProject(projectId: number): Promise<TaskProgressTally> {
    try {
        const rows = await prisma.$queryRaw<
            { done_count: bigint; total_count: bigint; weighted_done: bigint; weighted_total: bigint }[]
        >`
            SELECT
                COUNT(*) FILTER (WHERE "done") AS done_count,
                COUNT(*) AS total_count,
                COALESCE(SUM(
                    CASE
                        WHEN "groupId" IS NULL AND "quantityTarget" IS NOT NULL AND "quantityTarget" > 0
                            THEN LEAST("quantityTarget", GREATEST(0, COALESCE("quantityDone", 0)))
                        WHEN "done" THEN 1
                        ELSE 0
                    END
                ), 0) AS weighted_done,
                COALESCE(SUM(
                    CASE
                        WHEN "groupId" IS NULL AND "quantityTarget" IS NOT NULL AND "quantityTarget" > 0
                            THEN "quantityTarget"
                        ELSE 1
                    END
                ), 0) AS weighted_total
            FROM "ProjectTask"
            WHERE "projectId" = ${projectId}
        `;
        const row = rows[0];
        const done = Number(row?.done_count ?? BigInt(0));
        const total = Number(row?.total_count ?? BigInt(0));
        const weightedDone = Number(row?.weighted_done ?? BigInt(0));
        const weightedTotal = Number(row?.weighted_total ?? BigInt(0));
        return { done, total, percent: roundPercent(weightedDone, weightedTotal) };
    } catch (error) {
        console.log("Repository computeProgressByProject (task) error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error computing task progress.",
        };
    }
}

export type AssigneeProgress = { id: number; name: string; done: number; total: number; percent: number };

/**
 * Per-assignee {id, name, done, total, percent} for every intérimaire who has
 * at least one task, série or catégorie assigned to them in this project —
 * WITHOUT loading a single ProjectTask/ProjectTaskGroup/ProjectTaskCategory
 * row, for the project dashboard's "Avancement par intérimaire" section.
 *
 * Three independent sources are summed per assignee, matching the three
 * places components/AssigneePicker.tsx can attach an intérimaire (a task
 * — standalone OR nested inside a série —, a whole série, or a whole
 * catégorie):
 *
 *   1. `ProjectTask.assignedInterimId` directly on a task, weighted exactly
 *      like lib/projectDashboard.ts::computeTaskBarStats (a STANDALONE task
 *      with an active quantityTarget counts for that quantity; every other
 *      task — including one individually assigned while nested inside a
 *      série — counts as a plain 1/0, same `groupId IS NULL` guard as
 *      computeProgressByProject above, and for the same reason: a nested
 *      task's own quantityTarget, even if one were ever set, must not leak
 *      in here).
 *   2. `ProjectTaskGroup.assignedInterimId` on a whole série — its ENTIRE
 *      child task count, unweighted (1 per task), mirroring
 *      repository/taskGroups.ts::findByProject's own doneCount/totalCount.
 *   3. `ProjectTaskCategory.assignedInterimId` on a whole catégorie — the sum
 *      of every group filed under it (plain child-task counts, as above)
 *      plus every standalone task filed directly under it (quantity-weighted
 *      via computeTaskBarStats), i.e. exactly
 *      lib/projectDashboard.ts::computeTaskProgress's own `categoryBars`
 *      branch for that one catégorie.
 *
 * An assignee shows up even when a group/catégorie assigned to them happens
 * to be EMPTY (0 tasks under it) — a 0/0 row, not a silent omission: the
 * LEFT JOINs below intentionally still produce a zero-valued row for that
 * source rather than dropping the intérimaire from the result the way an
 * INNER JOIN would. Two assignees CAN legitimately double-count the same
 * task if it's individually reassigned away from its own série/catégorie's
 * assignee (e.g. a série assigned to A with one task inside it reassigned to
 * B) — each of the two people's own tally reflects what's actually assigned
 * to THEM, independently, across the same three orthogonal levels the picker
 * itself exposes; nothing here reconciles the two.
 *
 * Verified against lib/projectDashboard.ts::computeTaskBarStats/
 * computeTaskProgress with a hand-built scenario covering every branch above
 * (direct task, quantity-tracked direct task, task nested in a série,
 * an assignee's own série, an EMPTY série, a catégorie with a standalone
 * task + a nested série, and an EMPTY catégorie) before this function
 * existed — see the PR that introduced it.
 */
export async function computeProgressByInterim(projectId: number): Promise<AssigneeProgress[]> {
    try {
        const rows = await prisma.$queryRaw<{ id: number; name: string; done: bigint; total: bigint }[]>`
            WITH task_level AS (
                SELECT
                    "assignedInterimId" AS assignee_id,
                    COALESCE(SUM(
                        CASE
                            WHEN "groupId" IS NULL AND "quantityTarget" IS NOT NULL AND "quantityTarget" > 0
                                THEN LEAST("quantityTarget", GREATEST(0, COALESCE("quantityDone", 0)))
                            WHEN "done" THEN 1
                            ELSE 0
                        END
                    ), 0) AS done,
                    COALESCE(SUM(
                        CASE
                            WHEN "groupId" IS NULL AND "quantityTarget" IS NOT NULL AND "quantityTarget" > 0
                                THEN "quantityTarget"
                            ELSE 1
                        END
                    ), 0) AS total
                FROM "ProjectTask"
                WHERE "projectId" = ${projectId} AND "assignedInterimId" IS NOT NULL
                GROUP BY "assignedInterimId"
            ),
            group_level AS (
                SELECT
                    g."assignedInterimId" AS assignee_id,
                    COALESCE(COUNT(t.id) FILTER (WHERE t."done"), 0) AS done,
                    COALESCE(COUNT(t.id), 0) AS total
                FROM "ProjectTaskGroup" g
                LEFT JOIN "ProjectTask" t ON t."groupId" = g.id
                WHERE g."projectId" = ${projectId} AND g."assignedInterimId" IS NOT NULL
                GROUP BY g.id, g."assignedInterimId"
            ),
            category_children AS (
                SELECT "categoryId" AS category_id,
                    COALESCE(SUM(
                        CASE
                            WHEN "quantityTarget" IS NOT NULL AND "quantityTarget" > 0
                                THEN LEAST("quantityTarget", GREATEST(0, COALESCE("quantityDone", 0)))
                            WHEN "done" THEN 1
                            ELSE 0
                        END
                    ), 0) AS done,
                    COALESCE(SUM(
                        CASE
                            WHEN "quantityTarget" IS NOT NULL AND "quantityTarget" > 0
                                THEN "quantityTarget"
                            ELSE 1
                        END
                    ), 0) AS total
                FROM "ProjectTask"
                WHERE "projectId" = ${projectId} AND "groupId" IS NULL AND "categoryId" IS NOT NULL
                GROUP BY "categoryId"

                UNION ALL

                SELECT g."categoryId" AS category_id,
                    COALESCE(COUNT(t.id) FILTER (WHERE t."done"), 0) AS done,
                    COALESCE(COUNT(t.id), 0) AS total
                FROM "ProjectTaskGroup" g
                LEFT JOIN "ProjectTask" t ON t."groupId" = g.id
                WHERE g."projectId" = ${projectId} AND g."categoryId" IS NOT NULL
                GROUP BY g.id, g."categoryId"
            ),
            category_level AS (
                SELECT
                    c."assignedInterimId" AS assignee_id,
                    COALESCE(SUM(cc.done), 0) AS done,
                    COALESCE(SUM(cc.total), 0) AS total
                FROM "ProjectTaskCategory" c
                LEFT JOIN category_children cc ON cc.category_id = c.id
                WHERE c."projectId" = ${projectId} AND c."assignedInterimId" IS NOT NULL
                GROUP BY c.id, c."assignedInterimId"
            ),
            combined AS (
                SELECT assignee_id, done, total FROM task_level
                UNION ALL
                SELECT assignee_id, done, total FROM group_level
                UNION ALL
                SELECT assignee_id, done, total FROM category_level
            )
            SELECT
                i.id AS id,
                i.name AS name,
                COALESCE(SUM(combined.done), 0) AS done,
                COALESCE(SUM(combined.total), 0) AS total
            FROM combined
            JOIN "Interim" i ON i.id = combined.assignee_id
            WHERE i."projectId" = ${projectId}
            GROUP BY i.id, i.name
            ORDER BY i.name ASC
        `;
        return rows.map((row) => {
            const done = Number(row.done);
            const total = Number(row.total);
            return { id: row.id, name: row.name, done, total, percent: roundPercent(done, total) };
        });
    } catch (error) {
        console.log("Repository computeProgressByInterim (task) error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error computing task progress by intérimaire.",
        };
    }
}

/**
 * Same computation as computeProgressByInterim, mirror-imaged onto
 * SubcontractorCompany/assignedCompanyId — see that function's own doc for
 * the full reasoning (three sources summed, empty série/catégorie still
 * shown as a 0/0 row). Kept as a literal duplicate rather than a shared
 * helper parameterized by column/table name: the two column names
 * (`assignedInterimId`/`assignedCompanyId`) and joined tables
 * (`Interim`/`SubcontractorCompany`) are SQL identifiers, not values a
 * `$queryRaw` template can parameterize — the only way to share this would
 * be `Prisma.raw(...)` string-splicing a table/column name into the query,
 * which has no precedent anywhere else in this codebase's raw SQL. Two
 * occurrences of the same shape is exactly this project's own "leave it,
 * signal it" DRY threshold, not the "extract" one.
 */
export async function computeProgressByCompany(projectId: number): Promise<AssigneeProgress[]> {
    try {
        const rows = await prisma.$queryRaw<{ id: number; name: string; done: bigint; total: bigint }[]>`
            WITH task_level AS (
                SELECT
                    "assignedCompanyId" AS assignee_id,
                    COALESCE(SUM(
                        CASE
                            WHEN "groupId" IS NULL AND "quantityTarget" IS NOT NULL AND "quantityTarget" > 0
                                THEN LEAST("quantityTarget", GREATEST(0, COALESCE("quantityDone", 0)))
                            WHEN "done" THEN 1
                            ELSE 0
                        END
                    ), 0) AS done,
                    COALESCE(SUM(
                        CASE
                            WHEN "groupId" IS NULL AND "quantityTarget" IS NOT NULL AND "quantityTarget" > 0
                                THEN "quantityTarget"
                            ELSE 1
                        END
                    ), 0) AS total
                FROM "ProjectTask"
                WHERE "projectId" = ${projectId} AND "assignedCompanyId" IS NOT NULL
                GROUP BY "assignedCompanyId"
            ),
            group_level AS (
                SELECT
                    g."assignedCompanyId" AS assignee_id,
                    COALESCE(COUNT(t.id) FILTER (WHERE t."done"), 0) AS done,
                    COALESCE(COUNT(t.id), 0) AS total
                FROM "ProjectTaskGroup" g
                LEFT JOIN "ProjectTask" t ON t."groupId" = g.id
                WHERE g."projectId" = ${projectId} AND g."assignedCompanyId" IS NOT NULL
                GROUP BY g.id, g."assignedCompanyId"
            ),
            category_children AS (
                SELECT "categoryId" AS category_id,
                    COALESCE(SUM(
                        CASE
                            WHEN "quantityTarget" IS NOT NULL AND "quantityTarget" > 0
                                THEN LEAST("quantityTarget", GREATEST(0, COALESCE("quantityDone", 0)))
                            WHEN "done" THEN 1
                            ELSE 0
                        END
                    ), 0) AS done,
                    COALESCE(SUM(
                        CASE
                            WHEN "quantityTarget" IS NOT NULL AND "quantityTarget" > 0
                                THEN "quantityTarget"
                            ELSE 1
                        END
                    ), 0) AS total
                FROM "ProjectTask"
                WHERE "projectId" = ${projectId} AND "groupId" IS NULL AND "categoryId" IS NOT NULL
                GROUP BY "categoryId"

                UNION ALL

                SELECT g."categoryId" AS category_id,
                    COALESCE(COUNT(t.id) FILTER (WHERE t."done"), 0) AS done,
                    COALESCE(COUNT(t.id), 0) AS total
                FROM "ProjectTaskGroup" g
                LEFT JOIN "ProjectTask" t ON t."groupId" = g.id
                WHERE g."projectId" = ${projectId} AND g."categoryId" IS NOT NULL
                GROUP BY g.id, g."categoryId"
            ),
            category_level AS (
                SELECT
                    c."assignedCompanyId" AS assignee_id,
                    COALESCE(SUM(cc.done), 0) AS done,
                    COALESCE(SUM(cc.total), 0) AS total
                FROM "ProjectTaskCategory" c
                LEFT JOIN category_children cc ON cc.category_id = c.id
                WHERE c."projectId" = ${projectId} AND c."assignedCompanyId" IS NOT NULL
                GROUP BY c.id, c."assignedCompanyId"
            ),
            combined AS (
                SELECT assignee_id, done, total FROM task_level
                UNION ALL
                SELECT assignee_id, done, total FROM group_level
                UNION ALL
                SELECT assignee_id, done, total FROM category_level
            )
            SELECT
                comp.id AS id,
                comp.name AS name,
                COALESCE(SUM(combined.done), 0) AS done,
                COALESCE(SUM(combined.total), 0) AS total
            FROM combined
            JOIN "SubcontractorCompany" comp ON comp.id = combined.assignee_id
            WHERE comp."projectId" = ${projectId}
            GROUP BY comp.id, comp.name
            ORDER BY comp.name ASC
        `;
        return rows.map((row) => {
            const done = Number(row.done);
            const total = Number(row.total);
            return { id: row.id, name: row.name, done, total, percent: roundPercent(done, total) };
        });
    } catch (error) {
        console.log("Repository computeProgressByCompany (task) error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error computing task progress by subcontractor company.",
        };
    }
}

/**
 * The task's real project id, or null if it doesn't exist — resolved from
 * the row itself so callers can check project-scope access against the
 * task's actual project rather than trusting a caller-supplied one.
 */
export async function findProjectId(id: number): Promise<number | null> {
    try {
        const task = await prisma.projectTask.findUnique({ where: { id }, select: { projectId: true } });
        return task?.projectId ?? null;
    } catch (error) {
        console.log("Repository findProjectId (task) error:", error);
        throw { type: "repositoryError", message: "Database Error fetching task." };
    }
}

export async function toggle(id: number, done: boolean) {
    try {
        return await prisma.projectTask.update({ where: { id }, data: { done } });
    } catch (error) {
        console.log("Repository toggle task error:", error);
        throw {
            type: "repositoryError",
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
            type: "repositoryError",
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
            type: "repositoryError",
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
            type: "repositoryError",
            message: "Database Error updating task category.",
        };
    }
}

/** Sets a task's assignee (subcontractor company OR intérimaire — the caller passes at most one non-null). */
export async function setAssignee(id: number, data: { assignedCompanyId: number | null; assignedInterimId: number | null }) {
    try {
        return await prisma.projectTask.update({
            where: { id },
            data: { assignedCompanyId: data.assignedCompanyId, assignedInterimId: data.assignedInterimId },
        });
    } catch (error) {
        console.log("Repository setAssignee (task) error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error updating task assignee.",
        };
    }
}

export async function remove(id: number) {
    try {
        return await prisma.projectTask.delete({ where: { id } });
    } catch (error) {
        console.log("Repository remove task error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error deleting task.",
        };
    }
}
