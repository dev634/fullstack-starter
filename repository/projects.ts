import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";

export type ProjectSortField = "name" | "status" | "createdAt";

/**
 * The (non-trashed) projects with the given ids — used by the client portal,
 * which passes exactly the ids the logged-in contact is linked to. An empty
 * list yields no rows.
 */
export async function findByIds(ids: number[]) {
    try {
        if (ids.length === 0) return [];
        return await prisma.project.findMany({
            where: { id: { in: ids }, deletedAt: null },
            orderBy: [{ createdAt: "desc" }],
            select: {
                id: true,
                name: true,
                type: true,
                status: true,
                businessNumber: true,
                client: { select: { id: true, companyName: true } },
            },
        });
    } catch (error) {
        console.log("Repository findByIds (project) error:", error);
        throw { type: "error", message: "Database Error fetching projects." };
    }
}

type ProjectSearchArgs = {
    q?: string;
    sortField?: ProjectSortField;
    dir?: "asc" | "desc";
    page?: number;
    pageSize?: number;
};

/**
 * Paginated, filterable listing across every client's projects. `q` matches
 * the project name or the owning client's name/company. Excludes projects
 * whose client is in the trash.
 */
export async function search({
    q = "",
    sortField = "createdAt",
    dir = "desc",
    page = 1,
    pageSize = 12,
    projectIds,
}: ProjectSearchArgs & { projectIds?: number[] }) {
    const term = q.trim();
    const where: Prisma.ProjectWhereInput = {
        deletedAt: null,
        client: { deletedAt: null },
        // Restricted callers pass the projects they're assigned to. undefined
        // means unrestricted; an EMPTY array must still match nothing, so this
        // is a presence check, not a truthiness one.
        ...(projectIds !== undefined ? { id: { in: projectIds } } : {}),
        ...(term
            ? {
                OR: [
                    { name: { contains: term, mode: Prisma.QueryMode.insensitive } },
                    { client: { companyName: { contains: term, mode: Prisma.QueryMode.insensitive } } },
                    { client: { email: { contains: term, mode: Prisma.QueryMode.insensitive } } },
                ],
            }
            : {}),
    };

    try {
        const [projects, total] = await Promise.all([
            prisma.project.findMany({
                where,
                include: {
                    client: { select: { id: true, companyName: true, email: true } },
                },
                orderBy: { [sortField]: dir } as Prisma.ProjectOrderByWithRelationInput,
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
            prisma.project.count({ where }),
        ]);
        return { projects, total };
    } catch (error) {
        console.log("Repository search (project) error:", error);
        throw {
            type: "error",
            message: "Database Error searching projects.",
        };
    }
}

type ProjectData = {
    clientId: number;
    name: string;
    businessNumber?: string;
    type?: string;
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
                businessNumber: data.businessNumber || null,
                type: (data.type ?? "AUTRE") as never,
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

/** Projects for a client, most recently created first. Excludes trashed projects. */
export async function findByClient(clientId: number, projectIds?: number[]) {
    try {
        return await prisma.project.findMany({
            where: {
                clientId,
                deletedAt: null,
                // Restricted callers only see the chantiers they hold, even
                // inside a company they can otherwise reach.
                ...(projectIds !== undefined ? { id: { in: projectIds } } : {}),
            },
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
                businessNumber: data.businessNumber || null,
                type: (data.type ?? "AUTRE") as never,
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

/** Move a project to the trash (reversible). */
export async function softDelete(id: number) {
    try {
        return await prisma.project.update({
            where: { id },
            data: { deletedAt: new Date() },
        });
    } catch (error) {
        console.log("Repository softDelete project error:", error);
        throw {
            type: "error",
            message: "Database Error deleting project.",
        };
    }
}

/** Bring a trashed project back into the normal listings. */
export async function restore(id: number) {
    try {
        return await prisma.project.update({
            where: { id },
            data: { deletedAt: null },
        });
    } catch (error) {
        console.log("Repository restore project error:", error);
        throw {
            type: "error",
            message: "Database Error restoring project.",
        };
    }
}

/** Soft-deleted projects (trash), most recently deleted first. */
export async function findTrashed() {
    try {
        return await prisma.project.findMany({
            where: { deletedAt: { not: null } },
            include: {
                client: { select: { id: true, companyName: true } },
            },
            orderBy: { deletedAt: "desc" },
        });
    } catch (error) {
        console.log("Repository findTrashed project error:", error);
        throw {
            type: "error",
            message: "Database Error fetching trashed projects.",
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
