import { materialStockStatus } from "@/lib/materialStock";

type TaskLike = { done: boolean };
type TaskGroupLike = { id: number; name: string; totalCount: number; doneCount: number };
type MaterialLike = { quantity: number; requiredQuantity: number | null };

export type TaskProgressStats = {
  done: number;
  total: number;
  percent: number;
  groups: { id: number; name: string; done: number; total: number; percent: number }[];
};

/** Overall + per-series task completion, for the project dashboard. */
export function computeTaskProgress(tasks: TaskLike[], taskGroups: TaskGroupLike[]): TaskProgressStats {
  const ungroupedDone = tasks.filter((t) => t.done).length;
  const groupedDone = taskGroups.reduce((sum, g) => sum + g.doneCount, 0);
  const groupedTotal = taskGroups.reduce((sum, g) => sum + g.totalCount, 0);
  const done = ungroupedDone + groupedDone;
  const total = tasks.length + groupedTotal;
  return {
    done,
    total,
    percent: total > 0 ? Math.round((done / total) * 100) : 0,
    groups: taskGroups.map((g) => ({
      id: g.id,
      name: g.name,
      done: g.doneCount,
      total: g.totalCount,
      percent: g.totalCount > 0 ? Math.round((g.doneCount / g.totalCount) * 100) : 0,
    })),
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
