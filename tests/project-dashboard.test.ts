import { describe, it, expect } from "vitest";
import { computeTaskProgress, computeMaterialStockStats } from "@/lib/projectDashboard";

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
