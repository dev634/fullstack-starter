"use client";

import { deleteProject } from "@/actions/projects/projects";
import Modal from "@/components/Modal";
import { TrashIcon } from "@heroicons/react/24/outline";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";

type DeleteProjectButtonProps = {
  projectId: number;
  clientId: number;
  projectName: string;
};

export default function DeleteProjectButton({ projectId, clientId, projectName }: DeleteProjectButtonProps) {
  const { t } = useTranslation();
  const [openModal, setOpenModal] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleConfirmDelete() {
    setPending(true);
    setError(null);
    const result = await deleteProject(projectId, clientId);
    setPending(false);
    if (result.type === "error") {
      setError(result.message);
      return;
    }
    setOpenModal(false);
    router.refresh();
  }

  if (openModal) {
    return (
      <Modal
        title={t.projects.deleteModal.title}
        text={format(t.projects.deleteModal.text, { name: projectName })}
        error={error ?? undefined}
        textForCancel={t.common.cancel}
        textForConfirm={pending ? t.projects.deleteModal.deleting : t.common.delete}
        onClose={() => !pending && setOpenModal(false)}
        onConfirm={handleConfirmDelete}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setOpenModal(true)}
      aria-label={format(t.projects.deleteModal.deleteAriaLabel, { name: projectName })}
      className="inline-flex items-center gap-1 rounded border border-red-500/40 bg-transparent px-2.5 py-1.5 text-xs font-medium text-red-500 dark:text-red-400 hover:bg-red-500/10 cursor-pointer"
    >
      <TrashIcon className="h-3.5 w-3.5" />
      {t.common.delete}
    </button>
  );
}
