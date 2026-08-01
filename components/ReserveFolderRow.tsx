'use client'
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { FolderIcon, TrashIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";
import Modal from "@/components/Modal";
import { deleteReserveFolder } from "@/actions/reserves/reserves";
import { RESERVE_FOLDER_PARAM } from "@/lib/reserveFolderParam";

/**
 * One folder in the réserves browser — the same shape as ProjectFolderRow in
 * the Files module, so both sections navigate the same way.
 */
export default function ReserveFolderRow({
  folder,
  clientId,
  projectId,
  planCount,
  canEdit,
}: {
  folder: { id: number; name: string };
  clientId: number;
  projectId: number;
  planCount: number;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [openModal, setOpenModal] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep every other query param (the Files module browses through ?folder=
  // on this same page) so entering a réserve folder doesn't reset it.
  const params = new URLSearchParams(searchParams.toString());
  params.set(RESERVE_FOLDER_PARAM, String(folder.id));

  async function handleConfirmDelete() {
    setPending(true);
    setError(null);
    const result = await deleteReserveFolder(folder.id, clientId, projectId);
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
        href={`/clients/${clientId}/projects/${projectId}?${params.toString()}`}
        className="flex min-w-0 flex-1 items-center gap-2 text-sm hover:opacity-80"
      >
        <FolderIcon className="h-5 w-5 shrink-0 text-amber-400" />
        <span className="truncate">{folder.name}</span>
        <span className="shrink-0 text-xs text-gray-400">
          {format(t.reserves.planCount, { count: planCount })}
        </span>
      </Link>
      {canEdit && (
        <button
          type="button"
          onClick={() => setOpenModal(true)}
          aria-label={format(t.reserves.deleteFolder, { name: folder.name })}
          className="shrink-0 cursor-pointer rounded p-1 text-red-500 hover:bg-red-500/10 dark:text-red-400"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      )}
      {openModal && (
        <Modal
          title={format(t.reserves.deleteFolder, { name: folder.name })}
          text={format(t.reserves.deleteFolderText, { name: folder.name })}
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
