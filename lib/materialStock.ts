export type MaterialStockStatus = "green" | "orange" | "red";

export const STOCK_DOT_CLASSES: Record<MaterialStockStatus, string> = {
  green: "bg-green-500",
  orange: "bg-amber-500",
  red: "bg-red-500",
};

/**
 * Stock indicator for a material linked to a task: green when stock fully
 * covers what the task needs, red when nothing is in stock, orange for
 * everything in between (some stock, but not enough).
 */
export function materialStockStatus(quantity: number, requiredQuantity: number): MaterialStockStatus {
  if (quantity <= 0) return "red";
  if (quantity >= requiredQuantity) return "green";
  return "orange";
}
