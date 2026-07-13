'use client'
import { deleteTaskGroup } from "@/actions/taskGroups/taskGroups";
import Modal from "@/components/Modal";
import { TrashIcon } from "@heroicons/react/24/outline";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";

type DeleteTaskGroupButtonProps = {
  groupId: number;
  clientId: number;
  projectId: number;
  groupName: string;
  taskCount: number;
};

export default function DeleteTaskGroupButton({
  groupId,
  clientId,
  projectId,
  groupName,
  taskCount,
}: DeleteTaskGroupButtonProps) {
  const { t } = useTranslation();
  const [openModal, setOpenModal] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleConfirmDelete() {
    setPending(true);
    setError(null);
    const result = await deleteTaskGroup(groupId, clientId, projectId);
    setPending(false);
    if (result.type === "error") {
      setError(result.message);
      return;
    }
    setOpenModal(false);
    router.push(`/clients/${clientId}/projects/${projectId}`);
  }

  if (openModal) {
    return (
      <Modal
        title={t.tasks.group.deleteSeriesTitle}
        text={format(t.tasks.group.deleteSeriesText, { name: groupName, count: taskCount })}
        error={error ?? undefined}
        textForCancel={t.common.cancel}
        textForConfirm={pending ? t.tasks.group.deleting : t.tasks.group.deleteSeries}
        onClose={() => !pending && setOpenModal(false)}
        onConfirm={handleConfirmDelete}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setOpenModal(true)}
      className="inline-flex items-center gap-1.5 rounded border border-red-500/40 bg-transparent px-4 py-2 text-sm font-medium text-red-500 dark:text-red-400 hover:bg-red-500/10 cursor-pointer"
    >
      <TrashIcon className="h-4 w-4" />
      {t.tasks.group.deleteSeries}
    </button>
  );
}
