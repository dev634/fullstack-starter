/**
 * Badge colour classes per activity action, shared by the clients and
 * projects activity logs so the two stay visually in sync.
 */
export const ACTIVITY_ACTION_CLASSES: Record<string, string> = {
  CREATED: "border-green-300 bg-green-100 text-green-700 dark:border-green-500/30 dark:bg-green-500/15 dark:text-green-300",
  UPDATED: "border-blue-300 bg-blue-100 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-300",
  DELETED: "border-red-300 bg-red-100 text-red-700 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-300",
  RESTORED: "border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300",
  PERMANENTLY_DELETED: "border-red-300 bg-red-100 text-red-700 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-300",
  IMPORTED: "border-gray-300 bg-gray-100 text-gray-700 dark:border-gray-500/30 dark:bg-gray-500/15 dark:text-gray-300",
};
