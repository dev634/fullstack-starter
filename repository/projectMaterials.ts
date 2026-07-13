import { prisma } from "@/lib/prisma";

type MaterialData = {
    projectId: number;
    name: string;
    quantity: number;
    unit?: string;
    supplierName?: string;
    reference?: string;
    taskId?: number | null;
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
 * task's title (if any) so the UI can show what the stock indicator refers to.
 */
export async function findByProject(projectId: number) {
    try {
        return await prisma.projectMaterial.findMany({
            where: { projectId },
            include: { task: { select: { id: true, title: true } } },
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
