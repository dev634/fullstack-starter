/** The state every task action returns: type and message, field errors on a refused parse — no `data`. */
export type TaskActionState = {
  type: "error" | "success" | "zodError" | null;
  message: string;
  fieldsForm?: Record<string, string>;
};

/**
 * The state of the two task create actions (addTask, addTaskSeries) and of
 * their forms. The ONE thing those forms read back is the category the new task
 * or series landed in, so the page can reveal it — a literal built by the
 * action, never the created row. No other task action carries `data`: a reader
 * of it elsewhere is a compile error.
 */
export type CreatedTaskActionState = TaskActionState & { data?: { categoryId: number | null } };
