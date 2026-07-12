export type ProjectActionState = {
  type: "error" | "success" | "zodError" | null;
  message: string;
  fieldsForm?: Record<string, string>;
  data?: unknown;
};
