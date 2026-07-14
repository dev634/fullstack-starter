'use client'
import { addFolder } from "@/actions/projectFiles/projectFiles";
import { useActionState, useEffect, useRef, useState } from "react";
import { FolderPlusIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import type { ProjectFileActionState } from "@/types/projectFile";

const initialState: ProjectFileActionState = {
  type: null,
  message: "",
}

type CreateFolderFormProps = {
  clientId: number;
  projectId: number;
  parentId: number | null;
};

export default function CreateFolderForm({ clientId, projectId, parentId }: CreateFolderFormProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState<ProjectFileActionState, FormData>(
    addFolder,
    initialState
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.type === "success") formRef.current?.reset();
  }, [state]);

  // Collapse the form once a successful creation is reflected in state —
  // done during render (not an effect) per React's "adjust state while
  // rendering" pattern, since it must run before the closed button paints.
  const [lastHandledState, setLastHandledState] = useState(state);
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state.type === "success") setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2.5 py-1.5 text-xs font-medium hover:bg-[#d1d5dc] dark:hover:bg-gray-600 cursor-pointer"
      >
        <FolderPlusIcon className="h-3.5 w-3.5" />
        {t.files.newFolder}
      </button>
    );
  }

  return (
    <form ref={formRef} action={formAction} className="flex flex-wrap items-start gap-2">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="projectId" value={projectId} />
      {parentId != null && <input type="hidden" name="parentId" value={parentId} />}
      <div>
        <input
          type="text"
          name="name"
          autoFocus
          placeholder={t.files.folderNameLabel}
          aria-label={t.files.folderNameLabel}
          className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-1.5 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
        />
        {state.type === "zodError" && state.fieldsForm?.name && (
          <p className="mt-1 text-xs text-red-500">{state.fieldsForm.name}</p>
        )}
      </div>
      <button
        type="submit"
        disabled={isPending}
        className={`rounded bg-primary px-2.5 py-1.5 text-xs text-white hover:bg-primary/90 cursor-pointer ${
          isPending ? "opacity-50 cursor-not-allowed" : ""
        }`}
      >
        {t.common.create}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="rounded border border-gray-300 dark:border-gray-600 px-2.5 py-1.5 text-xs hover:bg-[#d1d5dc] dark:hover:bg-gray-700 cursor-pointer"
      >
        {t.common.cancel}
      </button>
      {state.type === "error" && (
        <p className="w-full text-xs text-red-500">{state.message}</p>
      )}
    </form>
  );
}
