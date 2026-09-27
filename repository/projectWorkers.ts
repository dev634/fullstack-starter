import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";

/**
 * Attaches a User (an internal employee) to a project as a "travailleur" —
 * the presence axis, orthogonal to _UserProjects' access axis (see
 * prisma/schema.prisma's ProjectWorker model doc). The caller must have
 * already resolved that `userId`'s role is not CLIENT from the database
 * (actions/projectWorkers/projectWorkers.ts) — a FK here only proves the row
 * exists, never what kind of row it is.
 */
export async function attach(projectId: number, userId: number) {
    try {
        return await prisma.projectWorker.create({
            data: { projectId, userId },
            select: { id: true, projectId: true, userId: true },
        });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            throw { type: "duplicate", message: "This user is already attached to this project." };
        }
        console.log("Repository attach (project worker) error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error attaching worker.",
        };
    }
}

/** Detaches a worker from its project — via the FK, this also clears (SetNull) every task/série/catégorie assignment it held on that project. */
export async function detach(id: number) {
    try {
        return await prisma.projectWorker.delete({ where: { id } });
    } catch (error) {
        console.log("Repository detach (project worker) error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error detaching worker.",
        };
    }
}

/**
 * The raw travailleur row for a project — deliberately WITHOUT a
 * `displayName`: this repository has no `t` (dictionary), so it cannot apply
 * the "Utilisateur #{id}" fallback lib/workerDisplayName.ts needs for a null
 * `name`, and it must never fall back to the email instead (see
 * `findAttachableUsers`'s own doc below for why). The caller — the workforce
 * page — maps this into `ProjectWorkerRow` below via `workerDisplayName`
 * before handing rows to the client component of the same name.
 */
export type ProjectWorkerData = {
    id: number;
    userId: number;
    name: string | null;
    jobFunctionName: string | null;
};

/**
 * Travailleurs (internal employees present on the chantier) for a project,
 * oldest first — the Personnel page's "Travailleurs" list. Mirrors
 * repository/interims.ts::findByProject, minus the columns that live on
 * `Interim` directly (name, agency): here they're read through the `User`
 * FK, so this needs an explicit `select` (User.password/email must never
 * surface).
 */
export async function findByProject(projectId: number): Promise<ProjectWorkerData[]> {
    try {
        const rows = await prisma.projectWorker.findMany({
            where: { projectId },
            orderBy: { createdAt: "asc" },
            select: {
                id: true,
                userId: true,
                user: {
                    select: {
                        name: true,
                        jobFunction: { select: { name: true } },
                    },
                },
            },
        });
        return rows.map((row) => ({
            id: row.id,
            userId: row.userId,
            name: row.user.name,
            jobFunctionName: row.user.jobFunction?.name ?? null,
        }));
    } catch (error) {
        console.log("Repository findByProject (project worker) error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error fetching workers.",
        };
    }
}

/**
 * The exact shape components/ProjectWorkerRow.tsx's props need — built by the
 * workforce page from `ProjectWorkerData` + `workerDisplayName(row, t)`,
 * never re-derived inside the client component itself. Exported here (not
 * declared client-side) so the component can `import type` it: a type-only
 * import is erased at compile time, so this never pulls this file's
 * Prisma-backed code into the client bundle. `name`/`userId` are
 * deliberately absent — the client component never needs either.
 */
export type ProjectWorkerRow = {
    id: number;
    displayName: string;
    jobFunctionName: string | null;
};

/**
 * Number of travailleurs attached to a project — the workforce hub card's
 * badge, never the full `findByProject` list. See
 * repository/interims.ts::countByProject's own doc for the same reasoning.
 */
export async function countByProject(projectId: number): Promise<number> {
    try {
        return await prisma.projectWorker.count({ where: { projectId } });
    } catch (error) {
        console.log("Repository countByProject (project worker) error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error counting workers.",
        };
    }
}

/**
 * `name` nullable, never the email — same reasoning as `ProjectWorkerData`
 * above: this repository has no `t`, so the caller (the task assignee
 * picker's own page) resolves the neutral "Utilisateur #{id}" fallback via
 * lib/workerDisplayName.ts before building the picker's AssigneeOption[].
 */
export type ProjectWorkerOption = { id: number; name: string | null };

/**
 * Just id + name of every travailleur attached to a project — for the
 * task/série/catégorie assignee picker (components/AssigneePicker.tsx's
 * AssigneeOption), same shape and same reasoning as
 * repository/interims.ts::findOptionsByProject: never the full row, and the
 * picker never needs a travailleur's job function to populate a `<select>`.
 */
export async function findOptionsByProject(projectId: number): Promise<ProjectWorkerOption[]> {
    try {
        const rows = await prisma.projectWorker.findMany({
            where: { projectId },
            select: { id: true, user: { select: { name: true } } },
            orderBy: { createdAt: "asc" },
        });
        return rows.map((row) => ({ id: row.id, name: row.user.name }));
    } catch (error) {
        console.log("Repository findOptionsByProject (project worker) error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error fetching worker options.",
        };
    }
}

/** The attachment's real project id, or null if it doesn't exist — see repository/tasks.ts::findProjectId. */
export async function findProjectId(id: number): Promise<number | null> {
    try {
        const worker = await prisma.projectWorker.findUnique({ where: { id }, select: { projectId: true } });
        return worker?.projectId ?? null;
    } catch (error) {
        console.log("Repository findProjectId (project worker) error:", error);
        throw { type: "repositoryError", message: "Database Error fetching worker." };
    }
}

// The add-worker selector lists the WHOLE organisation directory (every
// non-CLIENT user, not just this project's own crew) — a defensive ceiling
// against a pathological user count, the same role RESERVES_PER_PLAN_LIMIT
// plays in repository/reservePlans.ts and `take: 10000` plays in
// repository/contacts.ts's CSV export, not a routine page size any real
// organisation is expected to hit.
const MAX_ATTACHABLE_USERS = 500;

/**
 * `name` nullable, never the email (see `ProjectWorkerData`'s own doc above
 * for why this repository can't apply the "Utilisateur #{id}" fallback
 * itself). Sorting also moves to the caller: the old `orderBy: { email:
 * "asc" }` sorted by a column this type no longer carries, and there is no
 * SQL-level substitute for "the label the caller is about to display" — the
 * workforce page sorts the resolved labels in TS instead, after applying
 * lib/workerDisplayName.ts's fallback.
 *
 * NOT exported — forms/AttachWorkerForm.tsx declares its own local
 * `AttachableUserOption` (already resolved to a plain `name: string` by the
 * time it reaches that form), so this repository-side one had no importer at
 * all.
 */
type AttachableUserOption = { id: number; name: string | null };

/**
 * Non-CLIENT users not yet attached to this project — the add-worker
 * selector's own options. Excludes CLIENT portal logins at the query itself
 * (never surfaced as a choice at all) rather than relying only on the
 * action-layer role check at submit time; ids are still re-resolved and
 * re-checked server-side when the form is submitted (actions/projectWorkers/
 * projectWorkers.ts), since a list fetched at render time can go stale
 * before the form posts. Ordered by `id` for a stable, deterministic `take`
 * — which rows the ceiling above cuts must not depend on plan/scan order.
 */
export async function findAttachableUsers(projectId: number): Promise<AttachableUserOption[]> {
    try {
        const users = await prisma.user.findMany({
            where: { role: { not: "CLIENT" }, projectWorkers: { none: { projectId } } },
            select: { id: true, name: true },
            orderBy: { id: "asc" },
            take: MAX_ATTACHABLE_USERS,
        });
        return users.map((user) => ({ id: user.id, name: user.name }));
    } catch (error) {
        console.log("Repository findAttachableUsers (project worker) error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error fetching attachable users.",
        };
    }
}

/**
 * Whether a user is attached as a worker to at least one project — read by
 * actions/users/users.ts before letting an admin switch an already-attached
 * account's role to CLIENT (a portal login is never an employee; see
 * migration 20260920100000_project_workers's "WHAT THIS MIGRATION
 * DELIBERATELY DOES NOT ENFORCE" §1). Backed by the `userId` index, not a
 * full row scan.
 */
export async function hasAnyAttachment(userId: number): Promise<boolean> {
    try {
        const count = await prisma.projectWorker.count({ where: { userId } });
        return count > 0;
    } catch (error) {
        console.log("Repository hasAnyAttachment (project worker) error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error checking worker attachments.",
        };
    }
}
