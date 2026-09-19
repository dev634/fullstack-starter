import { materialStockStatus, countByStockStatus, STOCK_STATUS_ORDER, type MaterialStockStatus } from "@/lib/materialStock";

type TaskLike = { done: boolean; quantityTarget?: number | null; quantityDone?: number | null; categoryId?: number | null };

/** A percentage rounded to 2 decimal places (e.g. 0.3333 -> 33.33), not a whole number — every percent in this module (and dashboard/page.tsx's own group rollup) goes through this. */
export function roundPercent(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 10000) / 100 : 0;
}

/**
 * SVG arc length for the "done" stroke of a small progress ring (a full
 * "remaining" circle underneath, with a "done" arc drawn over it — see
 * components/charts/SeriesProgressRings.tsx). `percent` is clamped to
 * [0, 100]: the ring is never the only place that carries the value (the
 * dashboard always writes the percent as text next to it), so a malformed
 * input here can only ever mis-draw the arc, never mislead on its own.
 */
export function computeRingArc(percent: number, radius: number): { doneLength: number; circumference: number } {
  const circumference = 2 * Math.PI * radius;
  const clampedPercent = Math.min(100, Math.max(0, percent));
  return { doneLength: (clampedPercent / 100) * circumference, circumference };
}

/**
 * Per-task bar stats — a quantity-tracked task reports its actual count
 * (e.g. 32/50) instead of being flattened to a plain 0/1, so both the
 * dashboard's per-task bar and the overall weighted percent (below) reflect
 * real progress instead of only counting a task once it's fully done.
 */
export function computeTaskBarStats(task: TaskLike): { done: number; total: number; percent: number } {
  if (task.quantityTarget != null && task.quantityTarget > 0) {
    const doneQty = Math.min(task.quantityTarget, Math.max(0, task.quantityDone ?? 0));
    return { done: doneQty, total: task.quantityTarget, percent: roundPercent(doneQty, task.quantityTarget) };
  }
  return { done: task.done ? 1 : 0, total: 1, percent: task.done ? 100 : 0 };
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
 * — or a standalone task — assigned to a category is rolled up into that
 * category's own bar instead of appearing on its own, matching the project
 * detail page, where a categorized series or task is only shown nested
 * inside its category's section.
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
  // task counts ("2/16 tasks completed"), while percent is weighted by
  // each task's actual magnitude (its quantity target when tracked,
  // otherwise 1 like a plain checkbox) — so a task like "0/2894 panneaux"
  // pulls the overall percentage down proportionally to how much work it
  // actually represents, not just as "one task out of N" (which would
  // barely move the needle despite being most of the remaining work).
  const taskStats = tasks.map(computeTaskBarStats);
  const weightedDone = taskStats.reduce((sum, s) => sum + s.done, 0) + groupedDone;
  const weightedTotal = taskStats.reduce((sum, s) => sum + s.total, 0) + groupedTotal;

  const ungroupedSeries = taskGroups.filter((g) => g.categoryId == null);
  const categoryBars = taskCategories.map((category) => {
    const groupsInCategory = taskGroups.filter((g) => g.categoryId === category.id);
    // Weighted by each task's real magnitude (computeTaskBarStats), not a
    // flat +1 per task — otherwise a quantity-tracked task (e.g. target
    // 2894) would count as "1" toward its category's total instead of
    // 2894, making that category's bar tiny relative to its actual share
    // of the work, same rule the per-task bars below already apply.
    const taskStatsInCategory = tasks.filter((t) => t.categoryId === category.id).map(computeTaskBarStats);
    const catDone =
      groupsInCategory.reduce((sum, g) => sum + g.doneCount, 0) + taskStatsInCategory.reduce((sum, s) => sum + s.done, 0);
    const catTotal =
      groupsInCategory.reduce((sum, g) => sum + g.totalCount, 0) + taskStatsInCategory.reduce((sum, s) => sum + s.total, 0);
    return {
      id: `category-${category.id}`,
      name: category.name,
      done: catDone,
      total: catTotal,
      percent: roundPercent(catDone, catTotal),
    };
  });

  return {
    done,
    total,
    percent: roundPercent(weightedDone, weightedTotal),
    groups: [
      ...categoryBars,
      ...ungroupedSeries.map((g) => ({
        id: g.id,
        name: g.name,
        done: g.doneCount,
        total: g.totalCount,
        percent: roundPercent(g.doneCount, g.totalCount),
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

// ---------------------------------------------------------------------------
// Material categories — filing (WHAT a material is), entirely independent of
// the task/série/catégorie link above (WHY it's here, what drives the stock
// requirement). See ProjectMaterialCategory's own schema comment
// (schemas/materialCategory.ts) for the full distinction.
// ---------------------------------------------------------------------------

type MaterialCategoryLike = { id: number; name: string };
export type CategorizableMaterialLike = NamedMaterialLike & { materialCategoryId: number | null };

/**
 * A material category group, discriminated on `kind` rather than carrying a
 * synthetic sentinel id/name for the "no category" bucket (that sentinel —
 * `UNCATEGORIZED_MATERIAL_GROUP_ID`, compared with `typeof group.id ===
 * "number"` at every call site — is gone): the "category" branch is a real
 * `ProjectMaterialCategory` row (positive integer id, real name), the
 * "uncategorized" branch carries neither, because it isn't one. A caller
 * that needs an id/label for this bucket (a chart item's `key`, a PDF row's
 * heading) builds it locally — this type only describes what's actually
 * true of the data.
 */
export type MaterialCategoryGroup<M> =
  | { kind: "category"; id: number; name: string; materials: M[] }
  | { kind: "uncategorized"; materials: M[] };

/**
 * Partitions materials by their project-scoped material category, in the
 * order `categories` is given, with the "uncategorized" bucket last —
 * appended only when at least one material actually has no category, so a
 * fully-filed project never shows an empty "Non classé" row. Every real
 * category gets an entry even with zero materials (an empty category is
 * still a category the owner created).
 *
 * A material whose `materialCategoryId` doesn't match ANY of the categories
 * given — not just `null` — falls into the same "uncategorized" bucket
 * rather than silently vanishing from every view. That gap was real: a
 * category id pointing nowhere this call knows about (deleted since this
 * project's row was fetched, or a caller handed a narrower `categories` list
 * than the materials it's grouping) used to disappear from both the ring/
 * percent view and the PDF listing, without ever landing in "Non classé"
 * either — "non classé" must have exactly one meaning ("not filed anywhere
 * that exists"), not a silent third state nobody can see.
 *
 * Exported (not just used by computeMaterialCategoryGroups below) so a
 * caller that only needs the raw partition — without the stock math — can
 * reuse the exact same rule rather than re-deriving it.
 */
export function groupMaterialsByCategory<M extends CategorizableMaterialLike>(
  materials: readonly M[],
  categories: readonly MaterialCategoryLike[]
): MaterialCategoryGroup<M>[] {
  const known = new Set(categories.map((c) => c.id));
  const groups: MaterialCategoryGroup<M>[] = categories.map((category) => ({
    kind: "category",
    id: category.id,
    name: category.name,
    materials: materials.filter((m) => m.materialCategoryId === category.id),
  }));
  const uncategorized = materials.filter((m) => m.materialCategoryId == null || !known.has(m.materialCategoryId));
  if (uncategorized.length > 0) {
    groups.push({ kind: "uncategorized", materials: uncategorized });
  }
  return groups;
}

/**
 * Per-category progress for the dashboard's "Avancement par catégorie de
 * matériel" rings and the `.../tasks` page's own category sections — the
 * group AND its stock progress in one pass, so no caller zips a groups array
 * against a separately-computed progress array by index (they used to be two
 * functions, computeMaterialCategoryProgress + groupMaterialsByCategory,
 * called side by side and matched up by array position).
 *
 * "Progress" here is MaterialStockDonut's own definition, applied per
 * category instead of project-wide: the share of TRACKED materials
 * (requiredQuantity set) whose stock is green. `done` is the green count,
 * `total` the tracked count, `untracked` the rest (no requiredQuantity at
 * all) — counted so nothing silently disappears, but never folded into
 * percent, because a stock quantity and a "not tracked" material don't share
 * a unit and can't be summed (docs/CONVENTIONS.md).
 *
 * Stays pure and locale-less on purpose: a caller that renders this list (the
 * dashboard page's rings, or lib/dashboardReport.ts's buildMaterialCategoryGroups)
 * is the one that turns the "uncategorized" branch into a display id/label
 * (t.materials.category.uncategorized) — this function has no i18n context.
 */
export function computeMaterialCategoryGroups<M extends CategorizableMaterialLike>(
  materials: readonly M[],
  categories: readonly MaterialCategoryLike[]
): (MaterialCategoryGroup<M> & { done: number; total: number; percent: number; untracked: number })[] {
  return groupMaterialsByCategory(materials, categories).map((group) => {
    const tracked = computeTrackedMaterials(group.materials);
    const done = countByStockStatus(tracked).green;
    return {
      ...group,
      done,
      total: tracked.length,
      percent: roundPercent(done, tracked.length),
      untracked: group.materials.length - tracked.length,
    };
  });
}
