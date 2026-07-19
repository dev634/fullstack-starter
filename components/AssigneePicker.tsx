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
  assignedCompanyId: number | null;
  assignedInterimId: number | null;
};

/**
 * One self-contained dropdown to assign a task / series / category to EITHER
 * a subcontractor company OR an intérimaire — the two kinds sit in separate
 * <optgroup>s and the selection is encoded as "company:<id>" / "interim:<id>"
 * / "" (see schemas/taskAssignee.ts). Owns its own in-flight + error state
 * and refreshes on success, so the three call sites (task row, series row,
 * category section) don't each re-implement the handler. Renders nothing if
 * the project has no companies and no intérimaires yet.
 */
export default function AssigneePicker({
  targetKind,
  targetId,
  clientId,
  projectId,
  companies,
  interims,
  assignedCompanyId,
  assignedInterimId,
}: AssigneePickerProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (companies.length === 0 && interims.length === 0) return null;

  const value = assignedCompanyId ? `company:${assignedCompanyId}` : assignedInterimId ? `interim:${assignedInterimId}` : "";

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
      </select>
      {error && <span className="shrink-0 text-xs text-red-500">{error}</span>}
    </>
  );
}
