/** Outcome kind of a Server Action's state, as rendered by the toast. One definition; the per-feature action-state types still repeat the union (see the PR notes). */
export type ActionResultType = "success" | "error" | "zodError" | null;
