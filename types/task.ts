export type TaskActionState<TData = unknown> = {
  type: "error" | "success" | "zodError" | null;
  message: string;
  fieldsForm?: Record<string, string>;
  data?: TData;
};
