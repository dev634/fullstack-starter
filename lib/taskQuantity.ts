/**
 * What an EDIT of a task's quantity target does to its three coupled columns
 * (`quantityTarget`, `quantityDone`, `done`), as a PARTIAL patch — pure, so
 * the rule is testable without a database and the repository's `update` keeps
 * passing absent/null/value through untouched (lib/partialWrite.ts).
 *
 *   target `undefined`  -> {}: the target was not part of the edit, nothing
 *                         about the quantity is touched;
 *   target `null`       -> the task reverts to a plain checkbox: target and
 *                         done-quantity are cleared, `done` is left as it is
 *                         (the admin can flip it manually);
 *   target a number     -> re-clamps the existing quantityDone to the new
 *                         target and keeps `done` in sync. Newly turning ON
 *                         quantity tracking starts from the task's current
 *                         done state rather than always 0 — a task already
 *                         checked off shouldn't flip back to "not done" just
 *                         because an admin gave it a target.
 */
export type TaskQuantityState = { quantityTarget: number | null; quantityDone: number | null; done: boolean };
export type TaskQuantityPatch = { quantityTarget?: number | null; quantityDone?: number | null; done?: boolean };

export function quantityTargetPatch(current: TaskQuantityState, target: number | null | undefined): TaskQuantityPatch {
  if (target === undefined) return {};
  if (target === null) return { quantityTarget: null, quantityDone: null };
  const baselineDone = current.quantityTarget !== null ? (current.quantityDone ?? 0) : current.done ? target : 0;
  const quantityDone = Math.max(0, Math.min(baselineDone, target));
  return { quantityTarget: target, quantityDone, done: quantityDone >= target };
}
