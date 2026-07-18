import { materialStockStatus, STOCK_STATUS_ORDER, type MaterialStockStatus } from "@/lib/materialStock";

type TaskLike = { done: boolean; quantityTarget?: number | null; quantityDone?: number | null };

/**
 * A quantity-tracked task contributes its fractional progress (e.g. 30/50 ->
 * 0.6) instead of only counting once fully done — otherwise a task that's
 * 90% of the way there would count exactly the same as one that's untouched.
 * A plain checkbox task is still worth 0 or 1.
 */
function taskProgressFraction(task: TaskLike): number {
  if (task.quantityTarget != null && task.quantityTarget > 0) {
    return Math.min(1, Math.max(0, (task.quantityDone ?? 0) / task.quantityTarget));
  }
  return task.done ? 1 : 0;
}
type TaskGroupLike = { id: number; name: string; totalCount: number; doneCount: number; categoryId?: number | null };
type TaskCategoryLike = { id: number; name: string };
type MaterialLike = { quantity: number; requiredQuantity: number | null };
type NamedMaterialLike = MaterialLike & { id: number; name: string };

export type TaskProgressStats = {
  done: number;
  total: number;
  percent: number;
  groups: { id: number | string; name: string; done: number; total: number; percent: number }[];
};

/**
 * Overall + per-series task completion, for the project dashboard. A series
 * assigned to a category is rolled up into that category's own bar instead
 * of appearing on its own — matching the project detail page, where a
 * categorized series is only shown nested inside its category's section.
 */
export function computeTaskProgress(
  tasks: TaskLike[],
  taskGroups: TaskGroupLike[],
  taskCategories: TaskCategoryLike[] = []
): TaskProgressStats {
  const ungroupedDone = tasks.filter((t) => t.done).length;
  const groupedDone = taskGroups.reduce((sum, g) => sum + g.doneCount, 0);
  const groupedTotal = taskGroups.reduce((sum, g) => sum + g.totalCount, 0);
  const done = ungroupedDone + groupedDone;
  const total = tasks.length + groupedTotal;

  // percent is weighted separately from done/total: done/total stay whole
  // task counts ("2/16 tasks completed"), while percent additionally
  // credits partial progress on quantity-tracked tasks.
  const weightedDone = tasks.reduce((sum, t) => sum + taskProgressFraction(t), 0) + groupedDone;

  const ungroupedSeries = taskGroups.filter((g) => g.categoryId == null);
  const categoryBars = taskCategories.map((category) => {
    const groupsInCategory = taskGroups.filter((g) => g.categoryId === category.id);
    const catDone = groupsInCategory.reduce((sum, g) => sum + g.doneCount, 0);
    const catTotal = groupsInCategory.reduce((sum, g) => sum + g.totalCount, 0);
    return {
      id: `category-${category.id}`,
      name: category.name,
      done: catDone,
      total: catTotal,
      percent: catTotal > 0 ? Math.round((catDone / catTotal) * 100) : 0,
    };
  });

  return {
    done,
    total,
    percent: total > 0 ? Math.round((weightedDone / total) * 100) : 0,
    groups: [
      ...categoryBars,
      ...ungroupedSeries.map((g) => ({
        id: g.id,
        name: g.name,
        done: g.doneCount,
        total: g.totalCount,
        percent: g.totalCount > 0 ? Math.round((g.doneCount / g.totalCount) * 100) : 0,
      })),
    ],
  };
}

export type MaterialStockStats = {
  tracked: number;
  untracked: number;
  red: number;
  orange: number;
  green: number;
};

/** Red/orange/green breakdown across materials that have a linked task requirement. */
export function computeMaterialStockStats(materials: MaterialLike[]): MaterialStockStats {
  const stats: MaterialStockStats = { tracked: 0, untracked: 0, red: 0, orange: 0, green: 0 };
  for (const material of materials) {
    if (material.requiredQuantity == null) {
      stats.untracked += 1;
      continue;
    }
    stats.tracked += 1;
    stats[materialStockStatus(material.quantity, material.requiredQuantity)] += 1;
  }
  return stats;
}

export type TrackedMaterial = {
  id: number;
  name: string;
  quantity: number;
  requiredQuantity: number;
  status: MaterialStockStatus;
};

/**
 * Materials with a linked task requirement, each tagged with its stock status
 * and sorted worst-stock-first — the per-material detail behind the donut.
 * Shares the "tracked" predicate (requiredQuantity != null) with
 * computeMaterialStockStats so the two views can't drift apart.
 */
export function computeTrackedMaterials(materials: NamedMaterialLike[]): TrackedMaterial[] {
  return materials
    .filter((m): m is NamedMaterialLike & { requiredQuantity: number } => m.requiredQuantity != null)
    .map((m) => ({
      id: m.id,
      name: m.name,
      quantity: m.quantity,
      requiredQuantity: m.requiredQuantity,
      status: materialStockStatus(m.quantity, m.requiredQuantity),
    }))
    .sort((a, b) => STOCK_STATUS_ORDER[a.status] - STOCK_STATUS_ORDER[b.status]);
}
