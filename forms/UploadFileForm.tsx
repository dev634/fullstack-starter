'use client'
import { uploadFile } from "@/actions/projectFiles/projectFiles";
import { useActionState, useEffect, useRef } from "react";
import { ArrowUpTrayIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import type { ProjectFileActionState } from "@/types/projectFile";

const initialState: ProjectFileActionState = {
  type: null,
  message: "",
}

type UploadFileFormProps = {
  clientId: number;
  projectId: number;
  folderId: number | null;
};

export default function UploadFileForm({ clientId, projectId, folderId }: UploadFileFormProps) {
  const { t } = useTranslation();
  const [state, formAction, isPending] = useActionState<ProjectFileActionState, FormData>(
    uploadFile,
    initialState
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.type === "success") formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-6">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="projectId" value={projectId} />
      {folderId != null && <input type="hidden" name="folderId" value={folderId} />}
      <input
        type="file"
        name="file"
        aria-label={t.files.chooseFile}
        className="flex-1 min-w-[200px] text-sm text-gray-500 dark:text-gray-400 file:mr-3 file:rounded file:border-0 file:bg-gray-100 dark:file:bg-gray-700 file:px-3 file:py-1.5 file:text-sm file:text-gray-900 dark:file:text-gray-100 file:cursor-pointer"
      />
      <button
        type="submit"
        disabled={isPending}
        className={`inline-flex items-center gap-1.5 rounded bg-blue-500 px-3 py-2 text-sm text-white hover:bg-blue-600 cursor-pointer ${
          isPending ? "opacity-50 cursor-not-allowed" : ""
        }`}
      >
        <ArrowUpTrayIcon className="h-4 w-4" />
        {isPending ? t.common.sending : t.common.send}
      </button>
      {state.type === "error" && (
        <p className="w-full text-xs text-red-500">{state.message}</p>
      )}
    </form>
  );
}
