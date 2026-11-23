export type UserActionState = {
  type: "error" | "success" | "zodError" | null;
  message: string;
  fieldsForm?: Record<string, string>;
  /** Set by addUser only: the new account's id, which UsersManager needs to attach its project assignments. */
  data?: { id: number };
};
