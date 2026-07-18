'use client'
import { deleteIntervention, changeInterventionStatus } from "@/actions/interventions/interventions";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { TrashIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";
import { localeTag } from "@/lib/i18n/formatDate";
import InterventionStatusBadge from "@/components/InterventionStatusBadge";
import EditInterventionForm from "@/forms/EditInterventionForm";
import type { Intervention } from "@/app/generated/prisma/client";

type ProjectInterventionRowProps = {
  intervention: Intervention;
  clientId: number;
  projectId: number;
  canEdit: boolean;
};

export default function ProjectInterventionRow({ intervention, clientId, projectId, canEdit }: ProjectInterventionRowProps) {
  const { t, locale } = useTranslation();
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function handleStatusChange(status: string) {
    if (!canEdit || pending) return;
    setPending(true);
    await changeInterventionStatus(intervention.id, status, clientId, projectId);
    setPending(false);
    router.refresh();
  }

  async function handleDelete() {
    if (pending) return;
    setPending(true);
    await deleteIntervention(intervention.id, clientId, projectId);
    setPending(false);
    router.refresh();
  }

  return (
    <li className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
      <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
        {new Date(intervention.scheduledAt).toLocaleString(localeTag(locale), {
          dateStyle: "short",
          timeStyle: "short",
        })}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-gray-900 dark:text-gray-100">{intervention.description}</span>
        {intervention.technician && (
          <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
            {format(t.interventions.technician, { name: intervention.technician })}
          </span>
        )}
      </span>
      {canEdit ? (
        <select
          value={intervention.status}
          disabled={pending}
          onChange={(e) => handleStatusChange(e.target.value)}
          aria-label={t.interventions.statusLabel}
          className="shrink-0 cursor-pointer rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-1 text-xs text-gray-900 dark:text-gray-100 disabled:cursor-not-allowed"
        >
          <option value="PLANIFIEE">{t.interventions.status.PLANIFIEE}</option>
          <option value="FAITE">{t.interventions.status.FAITE}</option>
          <option value="ANNULEE">{t.interventions.status.ANNULEE}</option>
        </select>
      ) : (
        <InterventionStatusBadge status={intervention.status} />
      )}
      {canEdit && (
        <EditInterventionForm
          intervention={{
            id: intervention.id,
            scheduledAt: intervention.scheduledAt,
            description: intervention.description,
            technician: intervention.technician,
            status: intervention.status,
          }}
          clientId={clientId}
          projectId={projectId}
        />
      )}
      {canEdit && (
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          aria-label={format(t.interventions.deleteIntervention, { description: intervention.description })}
          className="shrink-0 cursor-pointer rounded p-1 text-red-500 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      )}
    </li>
  );
}
