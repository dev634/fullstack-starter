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

/** The material's real project id, or null if it doesn't exist — see repository/tasks.ts::findProjectId. */
export async function findProjectId(id: number): Promise<number | null> {
    try {
        const material = await prisma.projectMaterial.findUnique({ where: { id }, select: { projectId: true } });
        return material?.projectId ?? null;
    } catch (error) {
        console.log("Repository findProjectId (material) error:", error);
        throw { type: "error", message: "Database Error fetching material." };
    }
}

type MaterialUpdateData = {
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

/**
 * Edits a material's own fields, including its link (task/series/category):
 * the three FK columns are mutually exclusive by construction of the picker,
 * and an unset pick clears them all (SetNull-style) — so a scanned material,
 * which starts unlinked, can be attached to a task after the fact.
 */
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
                taskId: data.taskId ?? null,
                taskGroupId: data.taskGroupId ?? null,
                taskCategoryId: data.taskCategoryId ?? null,
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

type ScanApplyItem = {
    name: string;
    quantity: number;
    unit?: string | null;
    reference?: string | null;
    materialId?: number | null;
};

/**
 * Applies a reviewed delivery-note scan in a single transaction: for each
 * item, either increments a matched material's stock or creates a new
 * material. Atomic — a mid-list failure rolls the whole batch back rather
 * than leaving stock half-updated (which would double-apply on retry).
 * Stock increments are scoped to the project (updateMany with projectId) so
 * a stray materialId can't touch another project's stock.
 *
 * The note-level supplier and each item's reference are recorded only on
 * newly-created materials — matching an existing material just adds the
 * delivered quantity, leaving its own supplier/reference untouched.
 */
export async function applyScanItems(projectId: number, items: ScanApplyItem[], supplier?: string | null) {
    try {
        return await prisma.$transaction(
            items.map((item) =>
                item.materialId
                    ? prisma.projectMaterial.updateMany({
                          where: { id: item.materialId, projectId },
                          data: { quantity: { increment: item.quantity } },
                      })
                    : prisma.projectMaterial.create({
                          data: {
                              projectId,
                              name: item.name,
                              quantity: item.quantity,
                              unit: item.unit || null,
                              supplierName: supplier || null,
                              reference: item.reference || null,
                          },
                      })
            )
        );
    } catch (error) {
        console.log("Repository applyScanItems error:", error);
        throw {
            type: "error",
            message: "Database Error applying delivery scan.",
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
