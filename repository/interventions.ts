import { prisma } from "@/lib/prisma";
import type { InterventionStatus } from "@/app/generated/prisma/client";

type InterventionData = {
    projectId: number;
    scheduledAt: string;
    description: string;
    technician?: string;
    status?: InterventionStatus;
};

export async function create(data: InterventionData) {
    try {
        return await prisma.intervention.create({
            data: {
                projectId: data.projectId,
                scheduledAt: new Date(data.scheduledAt),
                description: data.description,
                technician: data.technician || null,
                status: data.status ?? "PLANIFIEE",
            },
        });
    } catch (error) {
        console.log("Repository create intervention error:", error);
        throw {
            type: "error",
            message: "Database Error creating intervention.",
        };
    }
}

/** Interventions for a project, soonest scheduled date first. */
export async function findByProject(projectId: number) {
    try {
        return await prisma.intervention.findMany({
            where: { projectId },
            orderBy: { scheduledAt: "asc" },
        });
    } catch (error) {
        console.log("Repository findByProject (intervention) error:", error);
        throw {
            type: "error",
            message: "Database Error fetching interventions.",
        };
    }
}

/** The intervention's real project id, or null if it doesn't exist — see repository/tasks.ts::findProjectId. */
export async function findProjectId(id: number): Promise<number | null> {
    try {
        const intervention = await prisma.intervention.findUnique({ where: { id }, select: { projectId: true } });
        return intervention?.projectId ?? null;
    } catch (error) {
        console.log("Repository findProjectId (intervention) error:", error);
        throw { type: "error", message: "Database Error fetching intervention." };
    }
}

type InterventionUpdateData = {
    scheduledAt: string;
    description: string;
    technician?: string;
    status: InterventionStatus;
};

export async function update(id: number, data: InterventionUpdateData) {
    try {
        return await prisma.intervention.update({
            where: { id },
            data: {
                scheduledAt: new Date(data.scheduledAt),
                description: data.description,
                technician: data.technician || null,
                status: data.status,
            },
        });
    } catch (error) {
        console.log("Repository update intervention error:", error);
        throw {
            type: "error",
            message: "Database Error updating intervention.",
        };
    }
}

export async function updateStatus(id: number, status: InterventionStatus) {
    try {
        return await prisma.intervention.update({ where: { id }, data: { status } });
    } catch (error) {
        console.log("Repository updateStatus intervention error:", error);
        throw {
            type: "error",
            message: "Database Error updating intervention.",
        };
    }
}

export async function remove(id: number) {
    try {
        return await prisma.intervention.delete({ where: { id } });
    } catch (error) {
        console.log("Repository remove intervention error:", error);
        throw {
            type: "error",
            message: "Database Error deleting intervention.",
        };
    }
}
