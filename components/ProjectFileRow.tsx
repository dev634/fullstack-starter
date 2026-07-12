'use client'
import { deleteFile } from "@/actions/projectFiles/projectFiles";
import Modal from "@/components/Modal";
import { DocumentIcon, TrashIcon } from "@heroicons/react/24/outline";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { ProjectFile } from "@/app/generated/prisma/client";

function formatSize(bytes: number | null, t: Dictionary): string {
  if (bytes == null) return "";
  if (bytes < 1024) return format(t.files.sizeBytes, { size: bytes });
  if (bytes < 1024 * 1024) return format(t.files.sizeKB, { size: (bytes / 1024).toFixed(0) });
  return format(t.files.sizeMB, { size: (bytes / (1024 * 1024)).toFixed(1) });
}

type ProjectFileRowProps = {
  file: ProjectFile;
  clientId: number;
  projectId: number;
  canEdit: boolean;
};

export default function ProjectFileRow({ file, clientId, projectId, canEdit }: ProjectFileRowProps) {
  const { t } = useTranslation();
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
        <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">{formatSize(file.size, t)}</span>
      )}
      {canEdit && (
        <button
          type="button"
          onClick={() => setOpenModal(true)}
          aria-label={format(t.files.deleteFile, { name: file.name })}
          className="shrink-0 cursor-pointer rounded p-1 text-red-500 hover:bg-red-500/10 dark:text-red-400"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      )}
      {openModal && (
        <Modal
          title={t.files.deleteFileTitle}
          text={format(t.files.deleteFileText, { name: file.name })}
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
