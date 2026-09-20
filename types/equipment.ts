// Same shape as types/intervention.ts — one action-state type per mutated
// model, shared by every useActionState form in the "Prêts" rubrique.

export type EquipmentActionState = {
  type: "error" | "success" | "zodError" | null;
  message: string;
  fieldsForm?: Record<string, string>;
  data?: unknown;
};

export type EquipmentLoanActionState = {
  type: "error" | "success" | "zodError" | null;
  message: string;
  fieldsForm?: Record<string, string>;
  data?: unknown;
};

/**
 * A candidate borrower for the "lend" form's <select> — projected to
 * {id, name}, never the full User row (password hash, access posture). Name
 * is nullable: a user created without one falls back to their email at the
 * component level, the same way UsersManager already does (`u.name ||
 * u.email`) — this type doesn't bake that fallback in, so the server-only
 * concern (what's safe to project) stays separate from the display concern.
 */
export type BorrowerOption = {
  id: number;
  name: string | null;
};
