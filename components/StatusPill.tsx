import type { ReactNode } from "react";

/**
 * Shared pill shell for every status/type badge in the app (StatusBadge,
 * ProjectStatusBadge, ProjectTypeBadge, InterventionStatusBadge,
 * ReserveStatusBadge): the same `inline-flex items-center rounded-full
 * border px-2 py-0.5 text-xs font-medium` shape was copy-pasted five times
 * and had already started to diverge (ReserveStatusBadge's `shrink-0`).
 * `className` carries the per-status color classes, plus any per-badge extra
 * (e.g. `shrink-0`) — the shape itself lives here once.
 *
 * No `"use client"` here: it's plain JSX with no client-only API, so it stays
 * safe to render from either a Server or a Client Component, exactly like the
 * badges that use it today.
 */
export default function StatusPill({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}
