export type AuthActionState = {
  type: "error" | "success" | "zodError" | null;
  message: string;
  fieldsForm?: Record<string, string>;
};
