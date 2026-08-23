import StatusPill from "@/components/StatusPill";
import { reserveStatusPillStyle } from "@/lib/reserveStatusPillStyle";
import type { ReserveStatus } from "@/app/generated/prisma/client";
import type { ResolvedReserveStatusStyle } from "@/lib/reserveStatusStyle";

/**
 * Shared "OPEN"/"RESOLVED" pill. Label and colour are no longer fixed: they
 * come from `style`, this project's resolved status presentation
 * (lib/reserveStatusStyle.ts::resolveReserveStatusStyle — already merges the
 * project's own configured label/colour with the product default, so this
 * component never touches the raw nullable columns or the i18n dictionary
 * itself). `reserveStatusPillStyle` turns the single configured hex into the
 * pill's background/border/text via `color-mix()` — see its own doc for why
 * text needs a different mechanism than background/border.
 *
 * No `"use client"`: label/colour now arrive as plain props instead of
 * through `useTranslation()`, so — like StatusPill itself — this is plain
 * JSX with no client-only API, safe to render from either a Server or a
 * Client Component (the client portal page renders it directly, and stays a
 * Server Component doing so; ReservesSection, a Client Component, renders it
 * too).
 */
export default function ReserveStatusBadge({
  status,
  style,
}: {
  status: ReserveStatus;
  style: ResolvedReserveStatusStyle;
}) {
  const entry = status === "RESOLVED" ? style.resolved : style.open;
  return (
    <StatusPill className="shrink-0" style={reserveStatusPillStyle(entry.color)}>
      {entry.label}
    </StatusPill>
  );
}
