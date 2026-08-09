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

/**
 * Add a material, accumulating into an existing line when it is the same item.
 *
 * "Same item" = same project + same reference + same supplier, matching how a
 * delivery-note scan tops up an existing material instead of listing it twice.
 * A reference is required to accumulate: without one there is no reliable key,
 * and merging every supplier's unreferenced items into one line would be worse
 * than a duplicate. When it does match, only the quantity moves — the existing
 * line keeps its own name, unit, task link and required quantity.
 *
 * Wrapped in a transaction so a match-then-increment can't race with a
 * concurrent add of the same reference.
 */
export async function createOrAccumulate(
    data: MaterialData
): Promise<{ material: Awaited<ReturnType<typeof create>>; accumulated: boolean }> {
    const reference = data.reference?.trim();
    if (!reference) {
        return { material: await create(data), accumulated: false };
    }

    try {
        return await prisma.$transaction(async (tx) => {
            const existing = await tx.projectMaterial.findFirst({
                where: {
                    projectId: data.projectId,
                    reference,
                    supplierName: data.supplierName?.trim() || null,
                },
                select: { id: true },
            });

            if (existing) {
                const material = await tx.projectMaterial.update({
                    where: { id: existing.id },
                    data: { quantity: { increment: data.quantity } },
                });
                return { material, accumulated: true };
            }

            const material = await tx.projectMaterial.create({
                data: {
                    projectId: data.projectId,
                    name: data.name,
                    quantity: data.quantity,
                    unit: data.unit || null,
                    supplierName: data.supplierName?.trim() || null,
                    reference,
                    taskId: data.taskId ?? null,
                    taskGroupId: data.taskGroupId ?? null,
                    taskCategoryId: data.taskCategoryId ?? null,
                    requiredQuantity: data.requiredQuantity ?? null,
                },
            });
            return { material, accumulated: false };
        });
    } catch (error) {
        console.log("Repository createOrAccumulate material error:", error);
        throw { type: "repositoryError", message: "Database Error creating material." };
    }
}

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
            type: "repositoryError",
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
            type: "repositoryError",
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
        throw { type: "repositoryError", message: "Database Error fetching material." };
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
            type: "repositoryError",
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
 * Thrown when one of the batch's `materialId`s matches no row in this
 * project — it belongs to another project, or has since been deleted.
 * `updateMany` does not throw on this by itself, it silently no-ops
 * (`{ count: 0 }` — the exact same trap already documented for
 * `cloudinary.destroy`, see lib/cloudinary.ts and the project's own rule on
 * this: an operation that doesn't throw hasn't necessarily acted). Thrown
 * explicitly here, INSIDE the transaction, so the whole batch rolls back
 * (applyScanItems's own "Atomic" guarantee, below) instead of the caller
 * reporting "Stock mis à jour" for a delivery that partially — or entirely —
 * never touched a single row.
 *
 * Deliberately carries no `.message`: unlike an opaque repository DB failure
 * (`{ type: "repositoryError" }`, always relayed as the caller's generic
 * fallback — see getErrorMessage, lib/helpers.ts), this is a specific,
 * already-understood case the ACTION layer translates itself, the same way
 * lib/deliveryNoteScan.ts's ScanErrorCode is translated via
 * t.materials.scan.errors — see isUnmatchedScanMaterialError below and its
 * use in actions/deliveryNoteScan/deliveryNoteScan.ts.
 */
export type UnmatchedScanMaterialError = { type: "unmatchedScanMaterial"; materialId: number };

export function isUnmatchedScanMaterialError(error: unknown): error is UnmatchedScanMaterialError {
    return (
        typeof error === "object" &&
        error !== null &&
        "type" in error &&
        (error as { type: unknown }).type === "unmatchedScanMaterial"
    );
}

/**
 * Applies a reviewed delivery-note scan in a single transaction: for each
 * item, either increments a matched material's stock or creates a new
 * material. Atomic — a mid-list failure rolls the whole batch back rather
 * than leaving stock half-updated (which would double-apply on retry).
 * Stock increments are scoped to the project (updateMany with projectId) so
 * a stray materialId can't touch another project's stock — and, since
 * `updateMany` reports how many rows it actually touched, a `materialId`
 * that matches ZERO rows is treated as a failure of the WHOLE batch too
 * (UnmatchedScanMaterialError, above), rather than silently reporting
 * success for a delivery that was never actually applied to stock. Runs as
 * an interactive transaction (not the array/batched form used before) so
 * each `updateMany`'s `count` can be checked before the transaction commits.
 *
 * The note-level supplier and each item's reference are recorded only on
 * newly-created materials — matching an existing material just adds the
 * delivered quantity, leaving its own supplier/reference untouched.
 */
export async function applyScanItems(projectId: number, items: ScanApplyItem[], supplier?: string | null) {
    try {
        return await prisma.$transaction(async (tx) => {
            const results = [];
            for (const item of items) {
                if (item.materialId) {
                    const { count } = await tx.projectMaterial.updateMany({
                        where: { id: item.materialId, projectId },
                        data: { quantity: { increment: item.quantity } },
                    });
                    if (count === 0) {
                        throw { type: "unmatchedScanMaterial", materialId: item.materialId } satisfies UnmatchedScanMaterialError;
                    }
                    results.push({ count });
                } else {
                    results.push(
                        await tx.projectMaterial.create({
                            data: {
                                projectId,
                                name: item.name,
                                quantity: item.quantity,
                                unit: item.unit || null,
                                supplierName: supplier || null,
                                reference: item.reference || null,
                            },
                        })
                    );
                }
            }
            return results;
        });
    } catch (error) {
        if (isUnmatchedScanMaterialError(error)) throw error;
        console.log("Repository applyScanItems error:", error);
        throw {
            type: "repositoryError",
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
            type: "repositoryError",
            message: "Database Error deleting material.",
        };
    }
}
