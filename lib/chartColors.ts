// Shared palette for progress charts (task completion donut + progress bars),
// so the "done" blue and "remaining" grey have a single source of truth
// instead of being re-declared as hex literals in each chart component.
// - PROGRESS_*_COLOR: raw hex for SVG charts (recharts can't read Tailwind classes)
// - PROGRESS_*_DOT_CLASS: matching Tailwind class for DOM legend dots (avoids
//   an inline style="" attribute, which the nonce-based CSP can't authorize)
export const PROGRESS_DONE_COLOR = "#3b82f6";
export const PROGRESS_REMAINING_COLOR = "#9ca3af";
export const PROGRESS_DONE_DOT_CLASS = "bg-[#3b82f6]";
export const PROGRESS_REMAINING_DOT_CLASS = "bg-[#9ca3af]";
