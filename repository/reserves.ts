import { prisma } from "@/lib/prisma";
import type { ReserveStatus } from "@/app/generated/prisma/client";

type ReserveCreateData = {
    planId: number;
    x: number;
    y: number;
    description: string;
    status?: ReserveStatus;
    latitude?: number | null;
    longitude?: number | null;
};

type ReserveUpdateData = {
    description: string;
    status: ReserveStatus;
    latitude?: number | null;
    longitude?: number | null;
};

/**
 * Create a réserve, drawing its number from the project's counter.
 *
 * The number comes from `Project.reserveCounter`, incremented in the same
 * transaction — NOT from max(number) + 1. The highest existing number falls
 * when a réserve is deleted, so max+1 would hand a retired number to a new
 * défaut, and a snagging report already sent to a contractor cites it.
 *
 * The increment is a single atomic UPDATE, so concurrent pins queue on that row
 * and each gets its own value: no collision to retry, and the unique constraint
 * on (projectId, number) is left as a backstop rather than a control flow.
 */
export async function create(data: ReserveCreateData) {
    try {
        return await prisma.$transaction(async (tx) => {
            const plan = await tx.reservePlan.findUnique({
                where: { id: data.planId },
                select: { projectId: true },
            });
            if (!plan) throw { type: "error", message: "Plan not found." };

            const project = await tx.project.update({
                where: { id: plan.projectId },
                data: { reserveCounter: { increment: 1 } },
                select: { reserveCounter: true },
            });

            return await tx.reserve.create({
                data: {
                    planId: data.planId,
                    projectId: plan.projectId,
                    number: project.reserveCounter,
                    x: data.x,
                    y: data.y,
                    description: data.description,
                    status: data.status ?? "OPEN",
                    latitude: data.latitude ?? null,
                    longitude: data.longitude ?? null,
                },
            });
        });
    } catch (error) {
        console.log("Repository create (reserve) error:", error);
        throw { type: "repositoryError", message: "Database Error creating réserve." };
    }
}

/** The réserve's real project id, or null if it doesn't exist — see repository/tasks.ts::findProjectId. */
export async function findProjectId(id: number): Promise<number | null> {
    try {
        const reserve = await prisma.reserve.findUnique({ where: { id }, select: { projectId: true } });
        return reserve?.projectId ?? null;
    } catch (error) {
        console.log("Repository findProjectId (reserve) error:", error);
        throw { type: "repositoryError", message: "Database Error fetching réserve." };
    }
}

/** Edits a réserve's description/status/GPS — never its position on the plan. */
export async function update(id: number, data: ReserveUpdateData) {
    try {
        return await prisma.reserve.update({
            where: { id },
            data: {
                description: data.description,
                status: data.status,
                latitude: data.latitude ?? null,
                longitude: data.longitude ?? null,
            },
        });
    } catch (error) {
        console.log("Repository update (reserve) error:", error);
        throw { type: "repositoryError", message: "Database Error updating réserve." };
    }
}

export async function remove(id: number) {
    try {
        return await prisma.reserve.delete({ where: { id } });
    } catch (error) {
        console.log("Repository remove (reserve) error:", error);
        throw { type: "repositoryError", message: "Database Error deleting réserve." };
    }
}

export type ReserveTally = { total: number; open: number; resolved: number };

/**
 * Accurate open/resolved/total counts for a WHOLE project, independent of
 * how many réserve rows a caller actually fetched for display.
 *
 * Passe 3b (C2), point 4: repository/reservePlans.ts::findByProject now
 * bounds each plan's nested `reserves` (RESERVES_PER_PLAN_LIMIT) for the two
 * UI surfaces (project page, portal page) — but lib/reservesReportData.ts's
 * summarizeReserves derives its tally from whatever `reserves` array it's
 * handed, so feeding it an already-truncated one would silently under-report
 * how many réserves are actually open, the exact "muette" failure this fix
 * exists to avoid. Queries Reserve directly — `projectId` is denormalised
 * onto it for exactly this kind of project-wide query (see the model's own
 * comment in prisma/schema.prisma) — rather than through the plan relation,
 * so the count stays correct no matter how any display-side query is bounded.
 * The PDF snagging report stays on summarizeReserves(plans): its own
 * findByProject call is unbounded, so that data is never truncated to begin
 * with (see findByProject's own doc for why the report opts out).
 */
export async function tallyByProject(projectId: number): Promise<ReserveTally> {
    try {
        const rows = await prisma.reserve.groupBy({
            by: ["status"],
            where: { projectId },
            _count: { _all: true },
        });
        const open = rows.find((r) => r.status === "OPEN")?._count._all ?? 0;
        const resolved = rows.find((r) => r.status === "RESOLVED")?._count._all ?? 0;
        return { total: open + resolved, open, resolved };
    } catch (error) {
        console.log("Repository tallyByProject (reserve) error:", error);
        throw { type: "repositoryError", message: "Database Error tallying réserves." };
    }
}
