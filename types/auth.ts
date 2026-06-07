export type AuthActionState = {
  type: "error" | "success" | "zodError" | null;
  message: string;
  fieldsForm?: { email?: string; password?: string };
};
