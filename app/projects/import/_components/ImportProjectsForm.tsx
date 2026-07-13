"use client";

import { useActionState } from "react";
import { importProjects, type ImportResult } from "@/actions/projects/projects";
import { ArrowUpTrayIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";

const initialState: ImportResult = { type: "success", message: "", created: 0, total: 0, errors: [] };

export default function ImportProjectsForm() {
  const { t } = useTranslation();
  const [state, formAction, isPending] = useActionState<ImportResult, FormData>(
    async (_prev, formData) => importProjects(formData),
    initialState
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 p-6 text-center">
        <ArrowUpTrayIcon className="mx-auto h-8 w-8 text-gray-400 dark:text-gray-500" />
        <label htmlFor="file" className="mt-2 block text-sm text-gray-600 dark:text-gray-300">
          {t.projects.import.chooseFile}
        </label>
        <input
          id="file"
          type="file"
          name="file"
          accept=".csv,text/csv"
          required
          className="mx-auto mt-3 block text-sm text-gray-600 dark:text-gray-300 file:mr-3 file:rounded file:border-0 file:bg-gray-100 file:dark:bg-gray-700 file:px-3 file:py-1.5 file:text-sm file:text-gray-900 file:dark:text-gray-100"
        />
      </div>

      <button
        type="submit"
        disabled={isPending}
        className={`w-full rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 cursor-pointer ${
          isPending ? "opacity-50 cursor-not-allowed" : ""
        }`}
      >
        {isPending ? t.projects.import.importing : t.projects.import.submit}
      </button>

      {state.message && (
        <div
          className={`rounded-lg border p-4 text-sm ${
            state.errors.length === 0
              ? "border-green-300 dark:border-green-500/30 bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-300"
              : "border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300"
          }`}
        >
          <p className="font-medium">{state.message}</p>
          {state.errors.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {state.errors.map((e, i) => (
                <li key={i}>
                  {format(t.projects.import.rowLabel, { row: e.row })}{e.email ? ` (${e.email})` : ""} : {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
