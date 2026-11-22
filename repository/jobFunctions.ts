import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { normalizeHiddenAreas, type AppAreaKey } from "@/lib/appAreas";

/** All job functions, in their manual (drag-and-drop) display order. */
export async function findAll() {
    try {
        return await prisma.jobFunction.findMany({ orderBy: [{ position: "asc" }, { name: "asc" }] });
    } catch (error) {
        console.log("Repository findAll (jobFunction) error:", error);
        throw { type: "repositoryError", message: "Database Error fetching functions." };
    }
}

/**
 * Just id + name, in display order — for populating dropdowns. Avoids
 * serializing the whole JobFunction row (hiddenSections / hiddenAreas /
 * projectScope — the access posture) to the client, unlike findAll().
 */
export async function findAllOptions() {
    try {
        return await prisma.jobFunction.findMany({
            select: { id: true, name: true },
            orderBy: [{ position: "asc" }, { name: "asc" }],
        });
    } catch (error) {
        console.log("Repository findAllOptions (jobFunction) error:", error);
        throw { type: "repositoryError", message: "Database Error fetching functions." };
    }
}

export async function create(name: string) {
    try {
        // New functions go to the end of the list.
        const last = await prisma.jobFunction.findFirst({ orderBy: { position: "desc" }, select: { position: true } });
        const position = (last?.position ?? -1) + 1;
        return await prisma.jobFunction.create({ data: { name, position } });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            throw { type: "duplicate", message: "This function already exists." };
        }
        console.log("Repository create (jobFunction) error:", error);
        throw { type: "repositoryError", message: "Database Error creating function." };
    }
}

export async function remove(id: number) {
    try {
        return await prisma.jobFunction.delete({ where: { id } });
    } catch (error) {
        console.log("Repository remove (jobFunction) error:", error);
        throw { type: "repositoryError", message: "Database Error deleting function." };
    }
}

/**
 * Write a function's whole access configuration — hidden project sections,
 * hidden app areas, project scope — in ONE statement. A single `update` on one
 * row is atomic by itself (all three columns land, or none does), which is
 * the point: the three former setters ran in parallel and a failure in one
 * left the other two written.
 */
export async function updateConfig(
    id: number,
    config: { hiddenSections: string[]; hiddenAreas: string[]; projectScope: "ALL" | "ASSIGNED" }
) {
    try {
        return await prisma.jobFunction.update({
            where: { id },
            data: {
                hiddenSections: config.hiddenSections,
                hiddenAreas: config.hiddenAreas,
                projectScope: config.projectScope,
            },
        });
    } catch (error) {
        console.log("Repository updateConfig (jobFunction) error:", error);
        throw { type: "repositoryError", message: "Database Error updating function configuration." };
    }
}

/** Persist a new order: each id's position becomes its index in the array. */
export async function reorder(orderedIds: number[]) {
    try {
        return await prisma.$transaction(
            orderedIds.map((id, index) => prisma.jobFunction.update({ where: { id }, data: { position: index } }))
        );
    } catch (error) {
        console.log("Repository reorder (jobFunction) error:", error);
        throw { type: "repositoryError", message: "Database Error reordering functions." };
    }
}

/** What a function hides, for the account policy (lib/accountPolicy.ts): normalized keys only. */
export async function findHiddenAreasById(id: number): Promise<AppAreaKey[]> {
    try {
        const row = await prisma.jobFunction.findUnique({ where: { id }, select: { hiddenAreas: true } });
        return normalizeHiddenAreas(row?.hiddenAreas);
    } catch (error) {
        console.log("Repository findHiddenAreasById (jobFunction) error:", error);
        throw { type: "repositoryError", message: "Database Error fetching function." };
    }
}

/** id + hiddenAreas of every function, in one query — server-side input of the screen's policy computations, never sent as is. */
export async function findAllHiddenAreas(): Promise<{ id: number; hiddenAreas: AppAreaKey[] }[]> {
    try {
        const rows = await prisma.jobFunction.findMany({ select: { id: true, hiddenAreas: true } });
        return rows.map((r) => ({ id: r.id, hiddenAreas: normalizeHiddenAreas(r.hiddenAreas) }));
    } catch (error) {
        console.log("Repository findAllHiddenAreas (jobFunction) error:", error);
        throw { type: "repositoryError", message: "Database Error fetching functions." };
    }
}
