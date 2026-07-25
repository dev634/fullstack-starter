'use client'
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TrashIcon, PlusIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";
import Modal from "@/components/Modal";
import { addJobFunction, deleteJobFunction } from "@/actions/jobFunctions/jobFunctions";
import type { JobFunctionActionState } from "@/types/jobFunction";
import type { JobFunction } from "@/app/generated/prisma/client";

const initialState: JobFunctionActionState = { type: null, message: "" };

export default function JobFunctionsManager({ functions }: { functions: JobFunction[] }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<JobFunctionActionState, FormData>(addJobFunction, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const [toDelete, setToDelete] = useState<JobFunction | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (state.type === "success") formRef.current?.reset();
  }, [state]);

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    setDeleteError(null);
    const res = await deleteJobFunction(toDelete.id);
    setDeleting(false);
    if (res.type === "error") {
      setDeleteError(res.message);
      return;
    }
    setToDelete(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <form ref={formRef} action={formAction} className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          name="name"
          placeholder={t.jobFunctions.addPlaceholder}
          aria-label={t.jobFunctions.addPlaceholder}
          className="flex-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
        />
        <button
          type="submit"
          disabled={isPending}
          className={`inline-flex items-center justify-center gap-1.5 rounded bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary/90 cursor-pointer ${
            isPending ? "opacity-50 cursor-not-allowed" : ""
          }`}
        >
          <PlusIcon className="h-4 w-4" />
          {t.jobFunctions.add}
        </button>
      </form>

      {state.type === "error" && <p className="text-xs text-red-500">{state.message}</p>}
      {state.type === "zodError" && state.fieldsForm?.name && (
        <p className="text-xs text-red-500">{state.fieldsForm.name}</p>
      )}

      {functions.length ? (
        <ul className="divide-y divide-gray-300 dark:divide-gray-700 overflow-hidden rounded-lg border border-gray-300 dark:border-gray-700">
          {functions.map((fn) => (
            <li
              key={fn.id}
              className="flex items-center justify-between gap-3 bg-[#f3f4f6] px-4 py-2.5 dark:bg-[#1f2937]"
            >
              <span className="min-w-0 truncate text-sm text-gray-900 dark:text-gray-100">{fn.name}</span>
              <button
                type="button"
                onClick={() => setToDelete(fn)}
                aria-label={format(t.jobFunctions.deleteLabel, { name: fn.name })}
                className="shrink-0 cursor-pointer rounded p-1 text-red-500 hover:bg-red-500/10 dark:text-red-400"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400">{t.jobFunctions.empty}</p>
      )}

      {toDelete && (
        <Modal
          title={t.jobFunctions.deleteTitle}
          text={format(t.jobFunctions.deleteText, { name: toDelete.name })}
          error={deleteError ?? undefined}
          textForCancel={t.common.cancel}
          textForConfirm={t.common.delete}
          onClose={() => !deleting && setToDelete(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}
