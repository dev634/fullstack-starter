/** The state of the account actions: type and message, field errors on a refused parse — no `data`. */
export type UserActionState = {
  type: "error" | "success" | "zodError" | null;
  message: string;
  fieldsForm?: Record<string, string>;
};

/** addUser only: the new account's id, which UsersManager needs to attach its project assignments. updateUser carries none. */
export type AddUserActionState = UserActionState & { data?: { id: number } };
