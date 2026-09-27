'use client'
import { useState } from "react";
import { useRouter } from "next/navigation";
import { setAssignee } from "@/actions/taskAssignee/taskAssignee";
import { useTranslation } from "@/components/LocaleProvider";
import type { AssigneeTargetKind } from "@/schemas/taskAssignee";

export type AssigneeOption = { id: number; name: string };

type AssigneePickerProps = {
  targetKind: AssigneeTargetKind;
  targetId: number;
  clientId: number;
  projectId: number;
  companies: AssigneeOption[];
  interims: AssigneeOption[];
  workers: AssigneeOption[];
  assignedCompanyId: number | null;
  assignedInterimId: number | null;
  assignedWorkerId: number | null;
};

/**
 * One self-contained dropdown to assign a task / series / category to EITHER
 * a subcontractor company, an intérimaire, OR an internal travailleur — the
 * three kinds sit in separate <optgroup>s and the selection is encoded as
 * "company:<id>" / "interim:<id>" / "worker:<id>" / "" (see
 * schemas/taskAssignee.ts). Owns its own in-flight + error state and
 * refreshes on success, so the call sites (task row, series row, category
 * section) don't each re-implement the handler.
 *
 * Renders nothing only when ALL THREE lists are empty AND there is no current
 * assignment — a project with, say, travailleurs but no companies/intérimaires
 * must still get the picker. When there IS an assignment but the caller's job
 * function hides the section that would have populated its list (e.g.
 * `interims` hidden while a task is assigned to a travailleur), the picker
 * still renders: the assignee's own kind-list is empty, but "Non assigné"
 * must stay reachable to actually clear the task — refusing to render would
 * make that task permanently un-unassignable from this UI. The current
 * assignee is shown as a disabled, neutral-label fallback option (never its
 * name/email — that would leak exactly what hiding the section was meant to
 * hide) rather than left to select a <select> value matching no <option>,
 * which renders as a blank/wrong state.
 */
export default function AssigneePicker({
  targetKind,
  targetId,
  clientId,
  projectId,
  companies,
  interims,
  workers,
  assignedCompanyId,
  assignedInterimId,
  assignedWorkerId,
}: AssigneePickerProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mutually exclusive by construction (schemas/taskAssignee.ts): at most one
  // of the three is ever non-null.
  const hasAssignment = assignedCompanyId != null || assignedInterimId != null || assignedWorkerId != null;

  if (companies.length === 0 && interims.length === 0 && workers.length === 0 && !hasAssignment) return null;

  const companyListed = assignedCompanyId != null && companies.some((c) => c.id === assignedCompanyId);
  const interimListed = assignedInterimId != null && interims.some((i) => i.id === assignedInterimId);
  const workerListed = assignedWorkerId != null && workers.some((w) => w.id === assignedWorkerId);
  // The assignment exists but its own list didn't carry it — the list this
  // caller received is missing exactly the row that matters here.
  const hiddenAssignee = hasAssignment && !companyListed && !interimListed && !workerListed;

  const value = companyListed
    ? `company:${assignedCompanyId}`
    : interimListed
      ? `interim:${assignedInterimId}`
      : workerListed
        ? `worker:${assignedWorkerId}`
        : hiddenAssignee
          ? "hidden"
          : "";

  async function handleChange(next: string) {
    setPending(true);
    setError(null);
    const res = await setAssignee(targetKind, targetId, next, clientId, projectId);
    setPending(false);
    if (res.type === "error") {
      setError(res.message);
      return;
    }
    router.refresh();
  }

  return (
    <>
      <select
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        disabled={pending}
        aria-label={t.assignees.label}
        className="shrink-0 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-1 text-xs text-gray-900 dark:text-gray-100 disabled:opacity-50"
      >
        <option value="">{t.assignees.none}</option>
        {hiddenAssignee && (
          // Selected and disabled: it's the current value but can't be
          // re-chosen (there is nothing valid to re-select it AS). "Non
          // assigné" above stays the only way out of this state from here.
          <option value="hidden" disabled>
            {t.assignees.hidden}
          </option>
        )}
        {companies.length > 0 && (
          <optgroup label={t.assignees.companies}>
            {companies.map((c) => (
              <option key={`company-${c.id}`} value={`company:${c.id}`}>
                {c.name}
              </option>
            ))}
          </optgroup>
        )}
        {interims.length > 0 && (
          <optgroup label={t.assignees.interims}>
            {interims.map((i) => (
              <option key={`interim-${i.id}`} value={`interim:${i.id}`}>
                {i.name}
              </option>
            ))}
          </optgroup>
        )}
        {workers.length > 0 && (
          <optgroup label={t.assignees.workers}>
            {workers.map((w) => (
              <option key={`worker-${w.id}`} value={`worker:${w.id}`}>
                {w.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {error && <span className="shrink-0 text-xs text-red-500">{error}</span>}
    </>
  );
}
