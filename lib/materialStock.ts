export type MaterialStockStatus = "green" | "orange" | "red";

// Single source of truth for the three stock statuses, in three forms:
// - STOCK_DOT_CLASSES: Tailwind classes for the colored dot in the DOM
// - STOCK_HEX: raw hex values for SVG charts (recharts can't read Tailwind classes)
// - STOCK_STATUS_ORDER: worst-stock-first ordering for lists and donut wedges
export const STOCK_DOT_CLASSES: Record<MaterialStockStatus, string> = {
  green: "bg-green-500",
  orange: "bg-amber-500",
  red: "bg-red-500",
};

export const STOCK_HEX: Record<MaterialStockStatus, string> = {
  green: "#22c55e",
  orange: "#f59e0b",
  red: "#ef4444",
};

export const STOCK_STATUS_ORDER: Record<MaterialStockStatus, number> = {
  red: 0,
  orange: 1,
  green: 2,
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
