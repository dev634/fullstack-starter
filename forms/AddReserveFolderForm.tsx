'use client'
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FolderPlusIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { addReserveFolder } from "@/actions/reserves/reserves";

/**
 * Create a folder for the project's reserve plans.
 *
 * Mirrors forms/CreateFolderForm in the Files module — an inline form that
 * expands from a header button — so both sections are created the same way.
 * Deletion lives on the folder row, as it does there.
 */
export default function AddReserveFolderForm({
  clientId,
  projectId,
  parentId,
}: {
  clientId: number;
  projectId: number;
  /** Create inside the folder currently being browsed (null = project root). */
  parentId: number | null;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      const res = await addReserveFolder(trimmed, clientId, projectId, parentId);
      if (res.type !== "success") {
        setError(res.message);
        return;
      }
      setName("");
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2.5 py-1.5 text-xs font-medium hover:bg-[#d1d5dc] dark:hover:bg-gray-600 cursor-pointer"
      >
        <FolderPlusIcon className="h-3.5 w-3.5" />
        {t.reserves.addFolderToggle}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-start gap-2">
      <input
        type="text"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder={t.reserves.newFolderPlaceholder}
        aria-label={t.reserves.newFolderPlaceholder}
        className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-1.5 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
      />
      <button
        type="button"
        onClick={submit}
        disabled={pending || !name.trim()}
        className={`rounded bg-primary px-2.5 py-1.5 text-xs text-white hover:bg-primary/90 cursor-pointer ${
          pending || !name.trim() ? "opacity-50 cursor-not-allowed" : ""
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
      {error && <p className="w-full text-xs text-red-500">{error}</p>}
    </div>
  );
}
