'use client'
import { addSubcontractorPerson } from "@/actions/subcontractors/subcontractors";
import { useActionState, useEffect, useRef } from "react";
import { useTranslation } from "@/components/LocaleProvider";
import type { SubcontractorActionState } from "@/types/subcontractor";

const initialState: SubcontractorActionState = {
  type: null,
  message: "",
}

export default function AddSubcontractorPersonForm({
  companyId,
  clientId,
  projectId,
}: {
  companyId: number;
  clientId: number;
  projectId: number;
}) {
  const { t } = useTranslation();
  const [state, formAction, isPending] = useActionState<SubcontractorActionState, FormData>(
    addSubcontractorPerson,
    initialState
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.type === "success") formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-col gap-2 bg-gray-50 px-4 py-3 dark:bg-gray-900/40 sm:flex-row sm:flex-wrap sm:items-start sm:px-6"
    >
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="projectId" value={projectId} />
      <div className="sm:min-w-[140px] sm:flex-1">
        <input
          type="text"
          name="name"
          placeholder={t.subcontractors.person.namePlaceholder}
          aria-label={t.subcontractors.person.nameLabel}
          className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
        />
        {state.type === "zodError" && state.fieldsForm?.name && (
          <p className="mt-1 text-xs text-red-500">{state.fieldsForm.name}</p>
        )}
      </div>
      <input
        type="text"
        name="role"
        placeholder={t.subcontractors.person.rolePlaceholder}
        aria-label={t.subcontractors.person.roleLabel}
        className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500 sm:w-auto sm:min-w-[120px]"
      />
      <input
        type="text"
        name="phone"
        placeholder={t.subcontractors.person.phonePlaceholder}
        aria-label={t.subcontractors.person.phoneLabel}
        className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500 sm:w-auto sm:min-w-[120px]"
      />
      <button
        type="submit"
        disabled={isPending}
        className={`rounded bg-primary px-3 py-2 text-sm text-white hover:bg-primary/90 cursor-pointer ${
          isPending ? "opacity-50 cursor-not-allowed" : ""
        }`}
      >
        {t.common.add}
      </button>
      {state.type === "error" && (
        <p className="w-full text-xs text-red-500">{state.message}</p>
      )}
    </form>
  );
}
