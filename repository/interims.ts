import { prisma } from "@/lib/prisma";

type InterimData = {
    projectId: number;
    name: string;
    role?: string;
    agency?: string;
};

export async function create(data: InterimData) {
    try {
        return await prisma.interim.create({
            data: {
                projectId: data.projectId,
                name: data.name,
                role: data.role || null,
                agency: data.agency || null,
            },
        });
    } catch (error) {
        console.log("Repository create interim error:", error);
        throw {
            type: "error",
            message: "Database Error creating interim.",
        };
    }
}

/** Interims (temp workers) for a project, oldest first. */
export async function findByProject(projectId: number) {
    try {
        return await prisma.interim.findMany({
            where: { projectId },
            orderBy: { createdAt: "asc" },
        });
    } catch (error) {
        console.log("Repository findByProject (interim) error:", error);
        throw {
            type: "error",
            message: "Database Error fetching interims.",
        };
    }
}

export async function remove(id: number) {
    try {
        return await prisma.interim.delete({ where: { id } });
    } catch (error) {
        console.log("Repository remove interim error:", error);
        throw {
            type: "error",
            message: "Database Error deleting interim.",
        };
    }
}
