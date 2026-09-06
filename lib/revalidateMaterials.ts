import { revalidatePath } from "next/cache";

/**
 * Every material mutation invalidates both the project hub (its Tâches link
 * card now carries the materials count too —
 * repository/projectMaterials.ts::countByProject, and the "Avancement"
 * summary card's stock-risk line — repository/projectMaterials.ts::
 * computeStockStatsByProject — are both derived straight from this data) AND
 * the dedicated `.../tasks` page, which now owns the actual material list
 * (Matériel joined Tâches — see lib/projectSections.ts's own doc).
 *
 * Deliberately not defined inside actions/projectMaterials/projectMaterials.ts
 * (its only caller until now): same reasoning as lib/revalidateFiles.ts,
 * whose own doc this mirrors — that file starts with `"use server"`, which
 * turns every exported function into a client-callable Server Action, and
 * actions/deliveryNoteScan/deliveryNoteScan.ts (which also creates/updates a
 * ProjectMaterial, via applyScanItems) needs to invalidate the exact same two
 * paths. Living here keeps "what invalidating Matériel means" defined in
 * exactly one place instead of a second hard-coded revalidatePath pair
 * drifting from the first the day a third route needs it.
 */
export function revalidateMaterials(clientId: number, projectId: number): void {
  const base = `/clients/${clientId}/projects/${projectId}`;
  revalidatePath(base);
  revalidatePath(`${base}/tasks`);
}
