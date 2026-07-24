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

export async function create(data: ReserveCreateData) {
    try {
        return await prisma.reserve.create({
            data: {
                planId: data.planId,
                x: data.x,
                y: data.y,
                description: data.description,
                status: data.status ?? "OPEN",
                latitude: data.latitude ?? null,
                longitude: data.longitude ?? null,
            },
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
