type BreadcrumbNode = { id: number; name: string; parentId: number | null; projectId: number };

/**
 * Walk `parentId` from `startId` up to the root, returning the chain
 * root→current (each entry is `{ id, name }`). `null` yields an empty chain.
 *
 * Shared by every folder tree (Files, réserve plans) so the breadcrumb logic
 * lives in one place. The hop bound is not decorative: a corrupt parent cycle
 * (A→B→A) would otherwise loop forever — a bug the Files module carried until
 * this was extracted.
 *
 * `findById` is intentionally the repository's plain, unscoped lookup (the
 * same one other callers use to *discover* a row's project before checking
 * access to it) — this function does the project scoping itself, by
 * comparing each node's `projectId` against the caller's. The moment a node
 * doesn't belong to `projectId` — the starting id, or (defensively) an
 * ancestor reached while walking up — the walk stops and that node's name
 * (and anything above it) is dropped from the chain, rather than rendering a
 * folder name from a project the caller isn't looking at.
 */
export async function buildBreadcrumb(
  startId: number | null,
  projectId: number,
  findById: (id: number) => Promise<BreadcrumbNode | null>,
  maxDepth = 100
): Promise<{ id: number; name: string }[]> {
  const chain: { id: number; name: string }[] = [];
  let current = startId;
  for (let hops = 0; current != null && hops < maxDepth; hops++) {
    const node = await findById(current);
    if (!node || node.projectId !== projectId) break;
    chain.unshift({ id: node.id, name: node.name });
    current = node.parentId;
  }
  return chain;
}
