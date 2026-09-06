import { revalidatePath } from "next/cache";

/**
 * Every folder/file mutation invalidates both the project hub (its Files
 * link card shows a plain COUNT — repository/projectFiles.ts::countByProject
 * — derived straight from this data) AND the dedicated files page
 * (`.../files`), which now owns the actual folder/file listing this data
 * feeds.
 *
 * Deliberately NOT defined inside actions/projectFiles/projectFiles.ts (its
 * only caller until now): that file starts with `"use server"`, which turns
 * every EXPORTED function into a client-callable Server Action —
 * tests/authz-coverage.test.ts scans exactly that export list expecting each
 * one to be a guarded mutation, and correctly flagged this helper the moment
 * it was exported from there for actions/deliveryNoteScan/deliveryNoteScan.ts
 * (a second file that also creates a ProjectFile — its archived delivery-note
 * photo — and needs to invalidate the same two paths) to reuse. Living here
 * instead keeps it an ordinary, non-"use server" server-side helper, and
 * keeps "what invalidating Files means" defined in exactly one place —
 * hard-coding a second `revalidatePath` pair in the caller that needed it
 * next would silently reopen this same gap the day a third route is added.
 */
export function revalidateFiles(clientId: number, projectId: number): void {
  const base = `/clients/${clientId}/projects/${projectId}`;
  revalidatePath(base);
  revalidatePath(`${base}/files`);
}
