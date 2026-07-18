import { describe, it, expect } from "vitest";
import {
  computeTaskProgress,
  computeTaskBarStats,
  computeMaterialStockStats,
  computeTrackedMaterials,
} from "@/lib/projectDashboard";

describe("computeTaskProgress", () => {
  it("returns 0% with no tasks or groups", () => {
    expect(computeTaskProgress([], [])).toEqual({ done: 0, total: 0, percent: 0, groups: [] });
  });

  it("combines ungrouped tasks and group counts", () => {
    const tasks = [{ done: true }, { done: false }, { done: true }];
    const groups = [{ id: 1, name: "Strings onduleur", totalCount: 10, doneCount: 4 }];
    const result = computeTaskProgress(tasks, groups);
    expect(result.done).toBe(6);
    expect(result.total).toBe(13);
    expect(result.percent).toBe(Math.round((6 / 13) * 100));
  });

  it("credits a quantity-tracked task's partial progress toward the overall percent", () => {
    // Not done (quantity-wise it's 60% there), so `done` stays 0 — but
    // percent should reflect the partial progress, not just 0%.
    const tasks = [{ done: false, quantityTarget: 50, quantityDone: 30 }];
    const result = computeTaskProgress(tasks, []);
    expect(result.done).toBe(0);
    expect(result.total).toBe(1);
    expect(result.percent).toBe(60);
  });

  it("mixes quantity-tracked and plain tasks when computing the overall percent", () => {
    const tasks = [
      { done: true },
      { done: false, quantityTarget: 50, quantityDone: 30 },
      { done: false, quantityTarget: 10, quantityDone: 0 },
    ];
    const result = computeTaskProgress(tasks, []);
    // done: only the plain completed task counts as a whole task.
    expect(result.done).toBe(1);
    expect(result.total).toBe(3);
    // percent: 1 (done) + 0.6 (quantity task) + 0 (quantity task) = 1.6 / 3 = 53%.
    expect(result.percent).toBe(Math.round((1.6 / 3) * 100));
  });

  it("treats a quantity-tracked task that reached its target as fully counted, even without done", () => {
    const tasks = [{ done: false, quantityTarget: 20, quantityDone: 20 }];
    const result = computeTaskProgress(tasks, []);
    expect(result.percent).toBe(100);
  });

  it("computes a percent per group", () => {
    const groups = [
      { id: 1, name: "A", totalCount: 4, doneCount: 2 },
      { id: 2, name: "B", totalCount: 0, doneCount: 0 },
    ];
    const result = computeTaskProgress([], groups);
    expect(result.groups).toEqual([
      { id: 1, name: "A", done: 2, total: 4, percent: 50 },
      { id: 2, name: "B", done: 0, total: 0, percent: 0 },
    ]);
  });

  it("rolls a categorized series up into its category's bar instead of its own", () => {
    const groups = [
      { id: 1, name: "Onduleur 13", totalCount: 10, doneCount: 5, categoryId: 1 },
      { id: 2, name: "Onduleur 14", totalCount: 10, doneCount: 5, categoryId: 1 },
      { id: 3, name: "Standalone series", totalCount: 4, doneCount: 4, categoryId: null },
    ];
    const categories = [{ id: 1, name: "Onduleurs" }];
    const result = computeTaskProgress([], groups, categories);
    expect(result.groups).toEqual([
      { id: "category-1", name: "Onduleurs", done: 10, total: 20, percent: 50 },
      { id: 3, name: "Standalone series", done: 4, total: 4, percent: 100 },
    ]);
    // Overall done/total is unaffected by the rollup — still counts every task once.
    expect(result.done).toBe(14);
    expect(result.total).toBe(24);
  });

  it("rolls a categorized standalone task up into its category's bar alongside its series", () => {
    const tasks = [
      { done: true, categoryId: 1 },
      { done: false, categoryId: 1 },
      { done: true, categoryId: null },
    ];
    const groups = [{ id: 1, name: "Onduleur 13", totalCount: 10, doneCount: 5, categoryId: 1 }];
    const categories = [{ id: 1, name: "Onduleurs" }];
    const result = computeTaskProgress(tasks, groups, categories);
    expect(result.groups).toEqual([
      { id: "category-1", name: "Onduleurs", done: 6, total: 12, percent: 50 },
    ]);
    // The uncategorized task doesn't appear in `groups` (it's not a series
    // or a category) — the dashboard page renders it as its own bar
    // separately, from the raw `tasks` list.
    expect(result.done).toBe(7);
    expect(result.total).toBe(13);
  });

  it("gives an empty category a 0% bar rather than dividing by zero", () => {
    const categories = [{ id: 1, name: "Empty category" }];
    const result = computeTaskProgress([], [], categories);
    expect(result.groups).toEqual([{ id: "category-1", name: "Empty category", done: 0, total: 0, percent: 0 }]);
  });
});

describe("computeTaskBarStats", () => {
  it("reports the actual count for a quantity-tracked task, not a flat 0/1", () => {
    const result = computeTaskBarStats({ done: false, quantityTarget: 50, quantityDone: 32 });
    expect(result).toEqual({ done: 32, total: 50, percent: 64 });
  });

  it("falls back to a plain 0/1 or 1/1 for a checkbox task", () => {
    expect(computeTaskBarStats({ done: false })).toEqual({ done: 0, total: 1, percent: 0 });
    expect(computeTaskBarStats({ done: true })).toEqual({ done: 1, total: 1, percent: 100 });
  });

  it("clamps quantityDone to the target range", () => {
    expect(computeTaskBarStats({ done: false, quantityTarget: 10, quantityDone: 15 })).toEqual({
      done: 10,
      total: 10,
      percent: 100,
    });
    expect(computeTaskBarStats({ done: false, quantityTarget: 10, quantityDone: -5 })).toEqual({
      done: 0,
      total: 10,
      percent: 0,
    });
  });
});

describe("computeMaterialStockStats", () => {
  it("counts untracked materials (no requiredQuantity) separately", () => {
    const materials = [{ quantity: 5, requiredQuantity: null }];
    expect(computeMaterialStockStats(materials)).toEqual({
      tracked: 0,
      untracked: 1,
      red: 0,
      orange: 0,
      green: 0,
    });
  });

  it("buckets tracked materials by stock status", () => {
    const materials = [
      { quantity: 0, requiredQuantity: 10 },
      { quantity: 5, requiredQuantity: 10 },
      { quantity: 10, requiredQuantity: 10 },
      { quantity: 20, requiredQuantity: null },
    ];
    expect(computeMaterialStockStats(materials)).toEqual({
      tracked: 3,
      untracked: 1,
      red: 1,
      orange: 1,
      green: 1,
    });
  });
});

describe("computeTrackedMaterials", () => {
  it("drops untracked materials (no requiredQuantity)", () => {
    const materials = [
      { id: 1, name: "Untracked", quantity: 5, requiredQuantity: null },
      { id: 2, name: "Tracked", quantity: 5, requiredQuantity: 10 },
    ];
    const result = computeTrackedMaterials(materials);
    expect(result.map((m) => m.id)).toEqual([2]);
  });

  it("tags each material with its status and sorts worst-stock-first", () => {
    const materials = [
      { id: 1, name: "Full", quantity: 10, requiredQuantity: 10 },
      { id: 2, name: "Empty", quantity: 0, requiredQuantity: 10 },
      { id: 3, name: "Partial", quantity: 5, requiredQuantity: 10 },
    ];
    const result = computeTrackedMaterials(materials);
    expect(result.map((m) => [m.name, m.status])).toEqual([
      ["Empty", "red"],
      ["Partial", "orange"],
      ["Full", "green"],
    ]);
  });
});
