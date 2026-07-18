export type SubcontractorActionState = {
  type: "error" | "success" | "zodError" | null;
  message: string;
  fieldsForm?: Record<string, string>;
  data?: unknown;
};
