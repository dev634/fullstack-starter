/** Shared shape for every réserve-related `useActionState` — plans, réserves
 * themselves, and the per-project status style. Kept as one type (not three
 * byte-for-byte copies of the same object) so a future field only needs
 * adding once; the three exported names below are aliases, not
 * redeclarations, so nothing at any of their many call sites needs to
 * change. */
type ReserveModuleActionState = {
  type: "error" | "success" | "zodError" | null;
  message: string;
  fieldsForm?: Record<string, string>;
  data?: unknown;
};

export type ReservePlanActionState = ReserveModuleActionState;
export type ReserveActionState = ReserveModuleActionState;
export type ReserveStatusStyleActionState = ReserveModuleActionState;
