import StatusPill from "@/components/StatusPill";
import type { ReserveStatus } from "@/app/generated/prisma/client";
import type { ResolvedReserveStatusStyle } from "@/lib/reserveStatusStyle";

/**
 * Shared "OPEN"/"RESOLVED" pill. Label and colour are no longer fixed: they
 * come from `style`, this project's resolved status presentation
 * (lib/reserveStatusStyle.ts::resolveReserveStatusStyle — already merges the
 * project's own configured label/colour with the product default, so this
 * component never touches the raw nullable columns or the i18n dictionary
 * itself).
 *
 * The colour itself is applied via a CLASS
 * (app/globals.css's `.reserve-pill-open`/`.reserve-pill-resolved`), never an
 * inline `style=""` attribute: this app's CSP has no 'unsafe-inline' for
 * style-src, and a nonce only authorizes a <style> ELEMENT, never a style
 * ATTRIBUTE. Those classes read the actual hex from CSS custom properties a
 * page injects once via ReserveStatusStyleVars (rendered by the project
 * detail page and the client-portal project page, the only two callers of
 * this component) — see that component's own doc for the full reasoning.
 *
 * No `"use client"`: label/colour arrive as plain props instead of through
 * `useTranslation()`, so — like StatusPill itself — this is plain JSX with no
 * client-only API, safe to render from either a Server or a Client Component
 * (the client portal page renders it directly, and stays a Server Component
 * doing so; ReservesSection, a Client Component, renders it too).
 */
export default function ReserveStatusBadge({
  status,
  style,
}: {
  status: ReserveStatus;
  style: ResolvedReserveStatusStyle;
}) {
  const entry = status === "RESOLVED" ? style.resolved : style.open;
  const colorClass = status === "RESOLVED" ? "reserve-pill-resolved" : "reserve-pill-open";
  return <StatusPill className={`shrink-0 ${colorClass}`}>{entry.label}</StatusPill>;
}
