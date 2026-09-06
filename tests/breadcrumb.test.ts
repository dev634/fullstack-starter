import { describe, it, expect, vi } from "vitest";
import { buildBreadcrumb } from "@/lib/breadcrumb";

type Node = { id: number; name: string; parentId: number | null; projectId: number };

function tree(nodes: Node[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return async (id: number) => byId.get(id) ?? null;
}

describe("buildBreadcrumb", () => {
  it("returns an empty chain for the root (null)", async () => {
    expect(await buildBreadcrumb(null, 1, async () => null)).toEqual([]);
  });

  it("walks parentId up to the root, ordered root→current", async () => {
    const find = tree([
      { id: 1, name: "A", parentId: null, projectId: 1 },
      { id: 2, name: "B", parentId: 1, projectId: 1 },
      { id: 3, name: "C", parentId: 2, projectId: 1 },
    ]);
    expect(await buildBreadcrumb(3, 1, find)).toEqual([
      { id: 1, name: "A" },
      { id: 2, name: "B" },
      { id: 3, name: "C" },
    ]);
  });

  it("stops at a missing ancestor rather than throwing", async () => {
    const find = tree([{ id: 2, name: "B", parentId: 99, projectId: 1 }]); // 99 doesn't exist
    expect(await buildBreadcrumb(2, 1, find)).toEqual([{ id: 2, name: "B" }]);
  });

  it("does not loop forever on a corrupt parent cycle", async () => {
    // A→B→A. Without the hop bound this hangs; with it, it terminates.
    const find = tree([
      { id: 1, name: "A", parentId: 2, projectId: 1 },
      { id: 2, name: "B", parentId: 1, projectId: 1 },
    ]);
    const findSpy = vi.fn(find);
    const chain = await buildBreadcrumb(1, 1, findSpy, 10);
    expect(chain.length).toBeLessThanOrEqual(10);
    expect(findSpy.mock.calls.length).toBeLessThanOrEqual(10);
  });

  it("yields an empty chain when the starting folder belongs to a different project", async () => {
    // A crafted `?folder=` id from another project must not surface that
    // project's folder name in the caller's breadcrumb — this is the
    // cross-project leak the projectId scoping closes. Applies to both
    // buildBreadcrumb callers: the Files module's own `?folder=` and the
    // réserves browser's (`.../reserves?folder=` since it got its own route).
    const find = tree([{ id: 5, name: "Another client's folder", parentId: null, projectId: 99 }]);
    expect(await buildBreadcrumb(5, 1, find)).toEqual([]);
  });

  it("truncates the chain the moment an ancestor leaves the project, rather than enumerating it", async () => {
    const find = tree([
      { id: 1, name: "Foreign root", parentId: null, projectId: 99 },
      { id: 2, name: "Mine", parentId: 1, projectId: 1 },
    ]);
    expect(await buildBreadcrumb(2, 1, find)).toEqual([{ id: 2, name: "Mine" }]);
  });
});
