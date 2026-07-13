"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { restoreProject, permanentlyDeleteProject } from "@/actions/projects/projects";
import Modal from "@/components/Modal";
import { ArrowUturnLeftIcon, TrashIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";

export default function TrashProjectActions({ projectId, name }: { projectId: number; name: string }) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleRestore() {
    setPending(true);
    setError(null);
    const res = await restoreProject(projectId);
    setPending(false);
    if (res.type === "error") {
      setError(res.message);
      return;
    }
    router.refresh();
  }

  async function handlePermanentDelete() {
    setPending(true);
    setError(null);
    const res = await permanentlyDeleteProject(projectId);
    setPending(false);
    if (res.type === "error") {
      setError(res.message);
      return;
    }
    setConfirming(false);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleRestore}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1.5 text-sm font-medium hover:bg-[#d1d5dc] dark:hover:bg-gray-600 cursor-pointer disabled:opacity-50"
      >
        <ArrowUturnLeftIcon className="h-4 w-4" />
        {t.projects.trash.restore}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded border border-red-500/40 px-3 py-1.5 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 cursor-pointer disabled:opacity-50"
      >
        <TrashIcon className="h-4 w-4" />
        {t.projects.trash.deleteForever}
      </button>

      {confirming && (
        <Modal
          title={t.projects.trash.deleteForeverTitle}
          text={format(t.projects.trash.deleteForeverText, { name })}
          error={error ?? undefined}
          textForCancel={t.common.cancel}
          textForConfirm={pending ? t.projects.deleteModal.deleting : t.projects.trash.deleteForever}
          onClose={() => !pending && setConfirming(false)}
          onConfirm={handlePermanentDelete}
        />
      )}
    </div>
  );
}
