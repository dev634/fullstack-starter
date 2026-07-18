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

// Fixed-order categorical palette (validated with the dataviz skill's
// validate_palette.js — CVD-safe adjacent pairs). Assign by index, never by
// rank/sort order, so a given task/series keeps its color across re-renders.
// Three of the eight steps sit below 3:1 contrast on a light surface, so
// every consumer must pair a slice with a visible text label (never color
// alone) — the "relief rule".
export const CATEGORICAL_COLORS = [
    "#2a78d6", // blue
    "#1baf7a", // aqua
    "#eda100", // yellow
    "#008300", // green
    "#4a3aa7", // violet
    "#e34948", // red
    "#e87ba4", // magenta
    "#eb6834", // orange
];
export const CATEGORICAL_OTHER_COLOR = "#9ca3af";

// Same 8 hexes as literal Tailwind arbitrary-value classes (plus "other"),
// for DOM legend dots — same CSP reasoning as PROGRESS_*_DOT_CLASS above.
// Written out (not template-generated) so Tailwind's static scanner sees
// every class name in source and actually generates the CSS for it.
export const CATEGORICAL_DOT_CLASSES = [
    "bg-[#2a78d6]",
    "bg-[#1baf7a]",
    "bg-[#eda100]",
    "bg-[#008300]",
    "bg-[#4a3aa7]",
    "bg-[#e34948]",
    "bg-[#e87ba4]",
    "bg-[#eb6834]",
];
export const CATEGORICAL_OTHER_DOT_CLASS = "bg-[#9ca3af]";
