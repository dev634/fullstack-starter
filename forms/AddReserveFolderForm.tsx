'use client'
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FolderPlusIcon, TrashIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";
import ModalShell from "@/components/ModalShell";
import { addReserveFolder, deleteReserveFolder } from "@/actions/reserves/reserves";

export type ReserveFolderOption = { id: number; name: string; planCount: number };

/**
 * Create/list/delete the folders that group a project's reserve plans.
 *
 * Lives in the section header next to "add a plan" — the two are the section's
 * creation actions, so they belong side by side rather than one being buried in
 * the body next to the plan picker.
 */
export default function AddReserveFolderForm({
  clientId,
  projectId,
  folders,
}: {
  clientId: number;
  projectId: number;
  folders: ReserveFolderOption[];
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      const res = await addReserveFolder(trimmed, clientId, projectId);
      if (res.type !== "success") {
        setError(res.message);
        return;
      }
      setName("");
      router.refresh();
    });
  }

  function remove(id: number) {
    setError(null);
    startTransition(async () => {
      const res = await deleteReserveFolder(id, clientId, projectId);
      if (res.type !== "success") {
        setError(res.message);
        return;
      }
      router.refresh();
    });
  }

  const inputClass =
    "w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2.5 py-1.5 text-xs font-medium hover:bg-[#d1d5dc] dark:hover:bg-gray-600 cursor-pointer"
      >
        <FolderPlusIcon className="h-3.5 w-3.5" />
        {t.reserves.addFolderToggle}
      </button>

      <ModalShell open={open} onClose={() => setOpen(false)} title={t.reserves.folders}>
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  create();
                }
              }}
              placeholder={t.reserves.newFolderPlaceholder}
              aria-label={t.reserves.newFolderPlaceholder}
              className={inputClass}
            />
            <button
              type="button"
              onClick={create}
              disabled={pending || !name.trim()}
              className={`shrink-0 rounded bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary/90 cursor-pointer ${
                pending || !name.trim() ? "opacity-50 cursor-not-allowed" : ""
              }`}
            >
              {t.reserves.addFolderSubmit}
            </button>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          {folders.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">{t.reserves.noFoldersYet}</p>
          ) : (
            <ul className="divide-y divide-gray-300 dark:divide-gray-700 overflow-hidden rounded border border-gray-300 dark:border-gray-700">
              {folders.map((f) => (
                <li
                  key={f.id}
                  className="flex items-center justify-between gap-3 bg-white dark:bg-gray-800 px-3 py-2"
                >
                  <span className="min-w-0 truncate text-sm">
                    {f.name}
                    <span className="ml-1.5 text-xs text-gray-400">
                      ({format(t.reserves.planCount, { count: f.planCount })})
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(f.id)}
                    disabled={pending}
                    aria-label={format(t.reserves.deleteFolder, { name: f.name })}
                    title={format(t.reserves.deleteFolderText, { name: f.name })}
                    className="shrink-0 cursor-pointer rounded p-1 text-red-500 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </ModalShell>
    </>
  );
}
