type TaskActionBase = {
  type: "error" | "success" | "zodError" | null;
  message: string;
  fieldsForm?: Record<string, string>;
};

/**
 * `data` is what a form reads back from the action — nothing else. Without a
 * `TData` the field does not exist on the type at all (not `data?: never`), so
 * a reader of a field no action returns is a compile error. A Server Action
 * never serialises a repository row it has no reader for.
 */
export type TaskActionState<TData = never> = [TData] extends [never] ? TaskActionBase : TaskActionBase & { data?: TData };

/**
 * The one thing the task create forms read back (AddTaskForm,
 * GenerateTaskSeriesForm): the category the new task / series landed in, so the
 * page can reveal it. A literal built by the action, never the created row.
 */
export type CreatedTaskData = { categoryId: number | null };
