'use client'
import { attachWorker } from "@/actions/projectWorkers/projectWorkers";
import { useActionState, useEffect, useRef, useState } from "react";
import { UserPlusIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import ModalShell from "@/components/ModalShell";
import type { ProjectWorkerActionState } from "@/types/projectWorker";

export type AttachableUserOption = { id: number; name: string };

const initialState: ProjectWorkerActionState = {
  type: null,
  message: "",
}

export default function AttachWorkerForm({
  clientId,
  projectId,
  users,
}: {
  clientId: number;
  projectId: number;
  users: AttachableUserOption[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState<ProjectWorkerActionState, FormData>(attachWorker, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  // Controlled, not defaultValue: React 19 clears every UNCONTROLLED field of
  // a `<form action>` at the end of ANY action run — a successful submit or
  // a zodError alike — so an uncontrolled select would lose the caller's
  // pick the moment the action round-trips, even on failure. Keeping it in
  // local state is what lets the selection survive a zodError.
  const [userId, setUserId] = useState("");
  const hasUsers = users.length > 0;

  useEffect(() => {
    if (state.type === "success") formRef.current?.reset();
  }, [state]);

  // Close the modal AND clear the controlled select once a successful attach
  // is reflected in state — done during render (this repo's ESLint forbids
  // calling setState synchronously inside an effect), same pattern as
  // AddInterimForm's own lastHandledState, extended here to also own the
  // controlled userId.
  const [lastHandledState, setLastHandledState] = useState(state);
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state.type === "success") {
      setOpen(false);
      setUserId("");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2.5 py-1.5 text-xs font-medium hover:bg-[#d1d5dc] dark:hover:bg-gray-600 cursor-pointer"
      >
        <UserPlusIcon className="h-3.5 w-3.5" />
        {t.workers.addToggle}
      </button>

      <ModalShell open={open} onClose={() => setOpen(false)} title={t.workers.addToggle}>
        {hasUsers ? (
          <form ref={formRef} action={formAction} className="flex flex-col gap-3">
            <input type="hidden" name="clientId" value={clientId} />
            <input type="hidden" name="projectId" value={projectId} />
            <div>
              <select
                name="userId"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                required
                autoFocus
                aria-label={t.workers.selectLabel}
                className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100"
              >
                <option value="" disabled>
                  {t.workers.selectPlaceholder}
                </option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
              {state.type === "zodError" && state.fieldsForm?.userId && (
                <p className="mt-1 text-xs text-red-500">{state.fieldsForm.userId}</p>
              )}
            </div>
            {(state.type === "error" || state.type === "zodError") && (
              <p className="text-xs text-red-500">{state.message}</p>
            )}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded bg-gray-100 px-4 py-2 font-bold text-gray-900 hover:bg-[#d1d5dc] dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600 cursor-pointer"
              >
                {t.common.cancel}
              </button>
              <button
                type="submit"
                disabled={isPending}
                className={`rounded bg-primary px-4 py-2 font-bold text-white hover:bg-primary/90 cursor-pointer ${
                  isPending ? "opacity-50 cursor-not-allowed" : ""
                }`}
              >
                {t.common.add}
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">{t.workers.noAttachableUsers}</p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded bg-gray-100 px-4 py-2 font-bold text-gray-900 hover:bg-[#d1d5dc] dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600 cursor-pointer"
              >
                {t.common.cancel}
              </button>
            </div>
          </div>
        )}
      </ModalShell>
    </>
  );
}
