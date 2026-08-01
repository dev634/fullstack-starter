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
        throw { type: "error", message: "Database Error creating réserve." };
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
        throw { type: "error", message: "Database Error updating réserve." };
    }
}

export async function remove(id: number) {
    try {
        return await prisma.reserve.delete({ where: { id } });
    } catch (error) {
        console.log("Repository remove (reserve) error:", error);
        throw { type: "error", message: "Database Error deleting réserve." };
    }
}
