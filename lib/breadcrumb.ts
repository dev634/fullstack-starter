type BreadcrumbNode = { id: number; name: string; parentId: number | null };

/**
 * Walk `parentId` from `startId` up to the root, returning the chain
 * root→current (each entry is `{ id, name }`). `null` yields an empty chain.
 *
 * Shared by every folder tree (Files, réserve plans) so the breadcrumb logic
 * lives in one place. The hop bound is not decorative: a corrupt parent cycle
 * (A→B→A) would otherwise loop forever — a bug the Files module carried until
 * this was extracted.
 */
export async function buildBreadcrumb(
  startId: number | null,
  findById: (id: number) => Promise<BreadcrumbNode | null>,
  maxDepth = 100
): Promise<{ id: number; name: string }[]> {
  const chain: { id: number; name: string }[] = [];
  let current = startId;
  for (let hops = 0; current != null && hops < maxDepth; hops++) {
    const node = await findById(current);
    if (!node) break;
    chain.unshift({ id: node.id, name: node.name });
    current = node.parentId;
  }
  return chain;
}
