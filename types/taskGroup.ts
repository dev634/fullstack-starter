export type TaskGroupActionState = {
  type: "error" | "success" | null;
  message: string;
  data?: unknown;
};
