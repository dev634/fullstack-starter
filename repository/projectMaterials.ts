import { prisma } from "@/lib/prisma";

type MaterialData = {
    projectId: number;
    name: string;
    quantity: number;
    unit?: string;
    supplierName?: string;
    reference?: string;
    taskId?: number | null;
    taskGroupId?: number | null;
    taskCategoryId?: number | null;
    requiredQuantity?: number | null;
};

export async function create(data: MaterialData) {
    try {
        return await prisma.projectMaterial.create({
            data: {
                projectId: data.projectId,
                name: data.name,
                quantity: data.quantity,
                unit: data.unit || null,
                supplierName: data.supplierName || null,
                reference: data.reference || null,
                taskId: data.taskId ?? null,
                taskGroupId: data.taskGroupId ?? null,
                taskCategoryId: data.taskCategoryId ?? null,
                requiredQuantity: data.requiredQuantity ?? null,
            },
        });
    } catch (error) {
        console.log("Repository create material error:", error);
        throw {
            type: "error",
            message: "Database Error creating material.",
        };
    }
}

/**
 * Materials for a project, most recently added first — includes the linked
 * task, task-series, or task-category name (if any) so the UI can show what
 * the stock indicator refers to.
 */
export async function findByProject(projectId: number) {
    try {
        return await prisma.projectMaterial.findMany({
            where: { projectId },
            include: {
                task: { select: { id: true, title: true } },
                taskGroup: { select: { id: true, name: true } },
                taskCategory: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: "desc" },
        });
    } catch (error) {
        console.log("Repository findByProject (material) error:", error);
        throw {
            type: "error",
            message: "Database Error fetching materials.",
        };
    }
}

type MaterialUpdateData = {
    name: string;
    quantity: number;
    unit?: string;
    supplierName?: string;
    reference?: string;
    requiredQuantity?: number | null;
};

/** Edits a material's own fields — never its link (task/series/category), which is set at creation. */
export async function update(id: number, data: MaterialUpdateData) {
    try {
        return await prisma.projectMaterial.update({
            where: { id },
            data: {
                name: data.name,
                quantity: data.quantity,
                unit: data.unit || null,
                supplierName: data.supplierName || null,
                reference: data.reference || null,
                requiredQuantity: data.requiredQuantity ?? null,
            },
        });
    } catch (error) {
        console.log("Repository update material error:", error);
        throw {
            type: "error",
            message: "Database Error updating material.",
        };
    }
}

/** Atomically adds (or subtracts, for a negative delta) to a material's stock quantity — used by the delivery note scanner. */
export async function addStock(id: number, delta: number) {
    try {
        return await prisma.projectMaterial.update({
            where: { id },
            data: { quantity: { increment: delta } },
        });
    } catch (error) {
        console.log("Repository addStock material error:", error);
        throw {
            type: "error",
            message: "Database Error updating material stock.",
        };
    }
}

export async function remove(id: number) {
    try {
        return await prisma.projectMaterial.delete({ where: { id } });
    } catch (error) {
        console.log("Repository remove material error:", error);
        throw {
            type: "error",
            message: "Database Error deleting material.",
        };
    }
}
