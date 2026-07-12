import { prisma } from "@/lib/prisma";

type ProjectData = {
    clientId: number;
    name: string;
    status: string;
    power?: number;
    budget?: number;
    address?: string;
    startDate?: string;
    endDate?: string;
    notes?: string;
};

export async function create(data: ProjectData) {
    try {
        const project = await prisma.project.create({
            data: {
                clientId: data.clientId,
                name: data.name,
                status: data.status as never,
                power: data.power ?? null,
                budget: data.budget ?? null,
                address: data.address || null,
                startDate: data.startDate ? new Date(data.startDate) : null,
                endDate: data.endDate ? new Date(data.endDate) : null,
                notes: data.notes || null,
            },
        });
        return project;
    } catch (error) {
        console.log("Repository create project error:", error);
        throw {
            type: "error",
            message: "Database Error creating project.",
        };
    }
}

/** Projects for a client, most recently created first. */
export async function findByClient(clientId: number) {
    try {
        return await prisma.project.findMany({
            where: { clientId },
            orderBy: { createdAt: "desc" },
        });
    } catch (error) {
        console.log("Repository findByClient error:", error);
        throw {
            type: "error",
            message: "Database Error fetching projects.",
        };
    }
}

export async function findById(id: number) {
    try {
        return await prisma.project.findUnique({
            where: { id },
            include: { client: true },
        });
    } catch (error) {
        console.log("Repository findById (project) error:", error);
        throw {
            type: "error",
            message: "Database Error fetching project.",
        };
    }
}

export async function update(id: number, data: ProjectData) {
    try {
        const project = await prisma.project.update({
            where: { id },
            data: {
                name: data.name,
                status: data.status as never,
                power: data.power ?? null,
                budget: data.budget ?? null,
                address: data.address || null,
                startDate: data.startDate ? new Date(data.startDate) : null,
                endDate: data.endDate ? new Date(data.endDate) : null,
                notes: data.notes || null,
            },
        });
        return project;
    } catch (error) {
        console.log("Repository update project error:", error);
        throw {
            type: "error",
            message: "Database Error updating project.",
        };
    }
}

export async function remove(id: number) {
    try {
        return await prisma.project.delete({ where: { id } });
    } catch (error) {
        console.log("Repository remove project error:", error);
        throw {
            type: "error",
            message: "Database Error deleting project.",
        };
    }
}

/** Per-status counts, e.g. for the client detail page or a dashboard widget. */
export async function countByStatus(clientId?: number) {
    try {
        const grouped = await prisma.project.groupBy({
            by: ["status"],
            where: clientId ? { clientId } : undefined,
            _count: { _all: true },
        });
        const byStatus: Record<string, number> = {
            ETUDE: 0, SIGNE: 0, EN_COURS: 0, RACCORDEMENT: 0, TERMINE: 0, ANNULE: 0,
        };
        for (const g of grouped) byStatus[g.status] = g._count._all;
        return byStatus;
    } catch (error) {
        console.log("Repository countByStatus error:", error);
        throw {
            type: "error",
            message: "Database Error counting projects.",
        };
    }
}
