'use client'
import { useState } from "react";
import { TrashIcon, BuildingOfficeIcon, ChevronDownIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";
import Modal from "@/components/Modal";
import { useDeleteConfirm } from "@/lib/useDeleteConfirm";
import { deleteSubcontractorCompany } from "@/actions/subcontractors/subcontractors";
import ProjectSubcontractorPersonRow from "@/components/ProjectSubcontractorPersonRow";
import AddSubcontractorPersonForm from "@/forms/AddSubcontractorPersonForm";
import type { SubcontractorPerson } from "@/app/generated/prisma/client";
import type { JobFunctionOption } from "@/forms/JobFunctionOptions";

type SubcontractorCompanyWithPersonnel = {
  id: number;
  name: string;
  personnel: (SubcontractorPerson & { jobFunction: { id: number; name: string } | null })[];
};

type ProjectSubcontractorCompanyRowProps = {
  company: SubcontractorCompanyWithPersonnel;
  clientId: number;
  projectId: number;
  canEdit: boolean;
  functions: JobFunctionOption[];
};

export default function ProjectSubcontractorCompanyRow({ company, clientId, projectId, canEdit, functions }: ProjectSubcontractorCompanyRowProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { confirming, setConfirming, pending, error, handleDelete } = useDeleteConfirm(() =>
    deleteSubcontractorCompany(company.id, clientId, projectId)
  );

  return (
    <li>
      <div className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 hover:opacity-80"
        >
          {open ? (
            <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 text-gray-500 dark:text-gray-400" />
          ) : (
            <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-gray-500 dark:text-gray-400" />
          )}
          <BuildingOfficeIcon className="h-4 w-4 shrink-0 text-amber-500" />
          <span className="min-w-0 flex-1 truncate text-left text-sm font-medium text-gray-900 dark:text-gray-100">
            {company.name}
          </span>
          <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
            ({company.personnel.length})
          </span>
        </button>
        {canEdit && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={pending}
            aria-label={format(t.subcontractors.company.deleteAriaLabel, { name: company.name })}
            className="shrink-0 cursor-pointer rounded p-1 text-red-500 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      {open && (
        <>
          {company.personnel.length ? (
            <ul className="divide-y divide-gray-300 bg-gray-50 dark:divide-gray-700 dark:bg-gray-900/40">
              {company.personnel.map((person) => (
                <ProjectSubcontractorPersonRow key={person.id} person={person} clientId={clientId} projectId={projectId} canEdit={canEdit} />
              ))}
            </ul>
          ) : (
            <p className="bg-gray-50 px-4 py-3 text-center text-xs text-gray-500 dark:bg-gray-900/40 dark:text-gray-400 sm:px-6">
              {t.subcontractors.person.none}
            </p>
          )}
          {canEdit && (
            <AddSubcontractorPersonForm companyId={company.id} clientId={clientId} projectId={projectId} functions={functions} />
          )}
        </>
      )}

      {confirming && (
        <Modal
          title={t.subcontractors.company.deleteCompanyTitle}
          text={format(t.subcontractors.company.deleteCompanyText, { name: company.name })}
          error={error ?? undefined}
          textForCancel={t.common.cancel}
          textForConfirm={pending ? t.subcontractors.company.deleting : t.subcontractors.company.deleteCompany}
          onClose={() => !pending && setConfirming(false)}
          onConfirm={handleDelete}
        />
      )}
    </li>
  );
}
