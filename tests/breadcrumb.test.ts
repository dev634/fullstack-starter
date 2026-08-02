import { describe, it, expect, vi } from "vitest";
import { buildBreadcrumb } from "@/lib/breadcrumb";

type Node = { id: number; name: string; parentId: number | null };

function tree(nodes: Node[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return async (id: number) => byId.get(id) ?? null;
}

describe("buildBreadcrumb", () => {
  it("returns an empty chain for the root (null)", async () => {
    expect(await buildBreadcrumb(null, async () => null)).toEqual([]);
  });

  it("walks parentId up to the root, ordered root→current", async () => {
    const find = tree([
      { id: 1, name: "A", parentId: null },
      { id: 2, name: "B", parentId: 1 },
      { id: 3, name: "C", parentId: 2 },
    ]);
    expect(await buildBreadcrumb(3, find)).toEqual([
      { id: 1, name: "A" },
      { id: 2, name: "B" },
      { id: 3, name: "C" },
    ]);
  });

  it("stops at a missing ancestor rather than throwing", async () => {
    const find = tree([{ id: 2, name: "B", parentId: 99 }]); // 99 doesn't exist
    expect(await buildBreadcrumb(2, find)).toEqual([{ id: 2, name: "B" }]);
  });

  it("does not loop forever on a corrupt parent cycle", async () => {
    // A→B→A. Without the hop bound this hangs; with it, it terminates.
    const find = tree([
      { id: 1, name: "A", parentId: 2 },
      { id: 2, name: "B", parentId: 1 },
    ]);
    const findSpy = vi.fn(find);
    const chain = await buildBreadcrumb(1, findSpy, 10);
    expect(chain.length).toBeLessThanOrEqual(10);
    expect(findSpy.mock.calls.length).toBeLessThanOrEqual(10);
  });
});
