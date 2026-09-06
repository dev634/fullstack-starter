import { prisma } from "@/lib/prisma";

type InterimData = {
    projectId: number;
    name: string;
    jobFunctionId?: number | null;
    agency?: string;
};

export async function create(data: InterimData) {
    try {
        return await prisma.interim.create({
            data: {
                projectId: data.projectId,
                name: data.name,
                jobFunctionId: data.jobFunctionId ?? null,
                agency: data.agency || null,
            },
        });
    } catch (error) {
        console.log("Repository create interim error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error creating interim.",
        };
    }
}

/** Interims (temp workers) for a project, oldest first. Includes each interim's job function (name). */
export async function findByProject(projectId: number) {
    try {
        return await prisma.interim.findMany({
            where: { projectId },
            orderBy: { createdAt: "asc" },
            include: {
                jobFunction: { select: { id: true, name: true } },
            },
        });
    } catch (error) {
        console.log("Repository findByProject (interim) error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error fetching interims.",
        };
    }
}

export type InterimOption = { id: number; name: string };

/**
 * Just id + name of every intérimaire in a project — for the task/série/
 * category assignee picker (components/AssigneePicker.tsx's AssigneeOption),
 * which never reads an intérimaire's job function or agency to populate a
 * `<select>`. Avoids the `include: { jobFunction: ... } }` findByProject
 * (above) needs for its own callers, same reasoning as
 * repository/tasks.ts::findLinkOptions.
 */
export async function findOptionsByProject(projectId: number): Promise<InterimOption[]> {
    try {
        return await prisma.interim.findMany({
            where: { projectId },
            select: { id: true, name: true },
            orderBy: { createdAt: "asc" },
        });
    } catch (error) {
        console.log("Repository findOptionsByProject (interim) error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error fetching interim options.",
        };
    }
}

/** The interim's real project id, or null if it doesn't exist — see repository/tasks.ts::findProjectId. */
export async function findProjectId(id: number): Promise<number | null> {
    try {
        const interim = await prisma.interim.findUnique({ where: { id }, select: { projectId: true } });
        return interim?.projectId ?? null;
    } catch (error) {
        console.log("Repository findProjectId (interim) error:", error);
        throw { type: "repositoryError", message: "Database Error fetching interim." };
    }
}

export async function remove(id: number) {
    try {
        return await prisma.interim.delete({ where: { id } });
    } catch (error) {
        console.log("Repository remove interim error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error deleting interim.",
        };
    }
}
