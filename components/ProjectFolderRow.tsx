'use client'
import Link from "next/link";
import { deleteFolder } from "@/actions/projectFiles/projectFiles";
import Modal from "@/components/Modal";
import { FolderIcon, TrashIcon } from "@heroicons/react/24/outline";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";
import type { ProjectFolder } from "@/app/generated/prisma/client";

type ProjectFolderRowProps = {
  folder: ProjectFolder;
  clientId: number;
  projectId: number;
  canEdit: boolean;
};

export default function ProjectFolderRow({ folder, clientId, projectId, canEdit }: ProjectFolderRowProps) {
  const { t } = useTranslation();
  const [openModal, setOpenModal] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleConfirmDelete() {
    setPending(true);
    setError(null);
    const result = await deleteFolder(folder.id, clientId, projectId);
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
      <Link
        href={`/clients/${clientId}/projects/${projectId}/files?folder=${folder.id}`}
        className="flex min-w-0 flex-1 items-center gap-2 text-sm hover:opacity-80"
      >
        <FolderIcon className="h-5 w-5 shrink-0 text-amber-400" />
        <span className="truncate">{folder.name}</span>
      </Link>
      {canEdit && (
        <button
          type="button"
          onClick={() => setOpenModal(true)}
          aria-label={format(t.files.deleteFolder, { name: folder.name })}
          className="shrink-0 cursor-pointer rounded p-1 text-red-500 hover:bg-red-500/10 dark:text-red-400"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      )}
      {openModal && (
        <Modal
          title={t.files.deleteFolderTitle}
          text={format(t.files.deleteFolderText, { name: folder.name })}
          error={error ?? undefined}
          textForCancel={t.common.cancel}
          textForConfirm={pending ? t.clients.deleteModal.deleting : t.common.delete}
          onClose={() => !pending && setOpenModal(false)}
          onConfirm={handleConfirmDelete}
        />
      )}
    </li>
  );
}
