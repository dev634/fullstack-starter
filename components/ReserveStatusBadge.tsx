"use client";

import { useTranslation } from "@/components/LocaleProvider";
import StatusPill from "@/components/StatusPill";
import type { ReserveStatus } from "@/app/generated/prisma/client";

// Same palette as the pin markers on the plan viewer (ReservesSection's
// `pinColor`) so the badge reads as "the same status", just in pill form —
// the pill shape itself lives in StatusPill, shared with
// ProjectStatusBadge/StatusBadge/ProjectTypeBadge/InterventionStatusBadge.
const STATUS_CLASSES: Record<ReserveStatus, string> = {
  OPEN: "border-rose-300 bg-rose-100 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300",
  RESOLVED: "border-green-300 bg-green-100 text-green-700 dark:border-green-500/30 dark:bg-green-500/15 dark:text-green-300",
};

/**
 * Shared "OPEN"/"RESOLVED" pill. `ReserveStatus` is a type-only import
 * (erased at compile time, see ReservesSection.tsx's doc on the same type),
 * so this stays safe to render straight from a Server Component — no server
 * dependency is pulled in, exactly like ProjectStatusBadge is already
 * rendered from the client-portal page without that page itself needing
 * `"use client"`.
 */
export default function ReserveStatusBadge({ status }: { status: ReserveStatus }) {
  const { t } = useTranslation();
  return <StatusPill className={`shrink-0 ${STATUS_CLASSES[status]}`}>{t.reserves.status[status]}</StatusPill>;
}
