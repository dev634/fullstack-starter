"use client";

import { deleteProject } from "@/actions/projects/projects";
import Modal from "@/components/Modal";
import { TrashIcon } from "@heroicons/react/24/outline";
import { useRouter } from "next/navigation";
import { useState } from "react";

type DeleteProjectButtonProps = {
  projectId: number;
  clientId: number;
  projectName: string;
};

export default function DeleteProjectButton({ projectId, clientId, projectName }: DeleteProjectButtonProps) {
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
        title="Supprimer ce projet"
        text={`Supprimer « ${projectName} » ? Cette action est irréversible.`}
        error={error ?? undefined}
        textForCancel="Annuler"
        textForConfirm={pending ? "Suppression…" : "Supprimer"}
        onClose={() => !pending && setOpenModal(false)}
        onConfirm={handleConfirmDelete}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setOpenModal(true)}
      aria-label={`Supprimer ${projectName}`}
      className="inline-flex items-center gap-1 rounded border border-red-500/40 bg-transparent px-2.5 py-1.5 text-xs font-medium text-red-500 dark:text-red-400 hover:bg-red-500/10 cursor-pointer"
    >
      <TrashIcon className="h-3.5 w-3.5" />
      Supprimer
    </button>
  );
}
