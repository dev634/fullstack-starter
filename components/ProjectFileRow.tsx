'use client'
import { deleteFile } from "@/actions/projectFiles/projectFiles";
import Modal from "@/components/Modal";
import { DocumentIcon, TrashIcon } from "@heroicons/react/24/outline";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ProjectFile } from "@/app/generated/prisma/client";

function formatSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

type ProjectFileRowProps = {
  file: ProjectFile;
  clientId: number;
  projectId: number;
  canEdit: boolean;
};

export default function ProjectFileRow({ file, clientId, projectId, canEdit }: ProjectFileRowProps) {
  const [openModal, setOpenModal] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleConfirmDelete() {
    setPending(true);
    setError(null);
    const result = await deleteFile(file.id, clientId, projectId);
    setPending(false);
    if (result.type === "error") {
      setError(result.message);
      return;
    }
    setOpenModal(false);
    router.refresh();
  }

  return (
    <li className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
      <a
        href={file.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex min-w-0 flex-1 items-center gap-2 text-sm hover:opacity-80"
      >
        <DocumentIcon className="h-5 w-5 shrink-0 text-blue-400" />
        <span className="truncate">{file.name}</span>
      </a>
      {file.size != null && (
        <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">{formatSize(file.size)}</span>
      )}
      {canEdit && (
        <button
          type="button"
          onClick={() => setOpenModal(true)}
          aria-label={`Supprimer le fichier ${file.name}`}
          className="shrink-0 cursor-pointer rounded p-1 text-red-500 hover:bg-red-500/10 dark:text-red-400"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      )}
      {openModal && (
        <Modal
          title="Supprimer ce fichier"
          text={`Supprimer « ${file.name} » ? Cette action est irréversible.`}
          error={error ?? undefined}
          textForCancel="Annuler"
          textForConfirm={pending ? "Suppression…" : "Supprimer"}
          onClose={() => !pending && setOpenModal(false)}
          onConfirm={handleConfirmDelete}
        />
      )}
    </li>
  );
}
