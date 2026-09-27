import { format } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/dictionaries";

/**
 * The one place that turns a travailleur's (User) row into a label — never
 * the raw email, which repository/projectWorkers.ts no longer sends to the
 * client at all (`AttachableUserOption`/`ProjectWorkerRow`/`AssigneeOption`
 * all carry `name: string | null`, not `email`). A User with no `name` set
 * (created before name became required, see schemas/user.ts) falls back to a
 * neutral, non-identifying label instead — never the email, and never
 * silently sorted/rendered as an empty string.
 *
 * Pure, so it's usable from a server component, a client component
 * (AssigneePicker), or a PDF report (lib/dashboardReport.ts) alike.
 */
export function workerDisplayName(user: { id: number; name: string | null }, t: Dictionary): string {
    return user.name ?? format(t.workers.unnamedUser, { id: user.id });
}
