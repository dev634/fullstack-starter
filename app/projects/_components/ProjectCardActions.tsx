"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EllipsisVerticalIcon, PencilSquareIcon, TrashIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";
import Modal from "@/components/Modal";
import { deleteProject } from "@/actions/projects/projects";

type ProjectCardActionsProps = {
  projectId: number;
  clientId: number;
  projectName: string;
};

export default function ProjectCardActions({ projectId, clientId, projectName }: ProjectCardActionsProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  async function handleConfirmDelete() {
    setPending(true);
    setError(null);
    const result = await deleteProject(projectId, clientId);
    setPending(false);
    if (result.type === "error") {
      setError(result.message);
      return;
    }
    setConfirming(false);
    router.refresh();
  }

  return (
    <div ref={menuRef} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={t.common.actions}
        className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 p-1.5 text-gray-600 dark:text-gray-300 hover:bg-[#d1d5dc] dark:hover:bg-gray-600 cursor-pointer"
      >
        <EllipsisVerticalIcon className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 w-40 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 py-1 shadow-lg">
          <Link
            href={`/clients/${clientId}/projects/${projectId}/edit`}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-[#d1d5dc] dark:hover:bg-gray-700"
            onClick={() => setOpen(false)}
          >
            <PencilSquareIcon className="h-4 w-4" />
            {t.common.edit}
          </Link>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setConfirming(true);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-500/10 cursor-pointer"
          >
            <TrashIcon className="h-4 w-4" />
            {t.common.delete}
          </button>
        </div>
      )}

      {confirming && (
        <Modal
          title={t.projects.deleteModal.title}
          text={format(t.projects.deleteModal.text, { name: projectName })}
          error={error ?? undefined}
          textForCancel={t.common.cancel}
          textForConfirm={pending ? t.projects.deleteModal.deleting : t.common.delete}
          onClose={() => !pending && setConfirming(false)}
          onConfirm={handleConfirmDelete}
        />
      )}
    </div>
  );
}
