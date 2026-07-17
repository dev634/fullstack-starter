'use client'
import { deleteTaskCategory } from "@/actions/taskCategories/taskCategories";
import Modal from "@/components/Modal";
import { TrashIcon } from "@heroicons/react/24/outline";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";

type DeleteTaskCategoryButtonProps = {
  categoryId: number;
  clientId: number;
  projectId: number;
  categoryName: string;
};

export default function DeleteTaskCategoryButton({
  categoryId,
  clientId,
  projectId,
  categoryName,
}: DeleteTaskCategoryButtonProps) {
  const { t } = useTranslation();
  const [openModal, setOpenModal] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleConfirmDelete() {
    setPending(true);
    setError(null);
    const result = await deleteTaskCategory(categoryId, clientId, projectId);
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
        title={t.tasks.category.deleteCategoryTitle}
        text={format(t.tasks.category.deleteCategoryText, { name: categoryName })}
        error={error ?? undefined}
        textForCancel={t.common.cancel}
        textForConfirm={pending ? t.tasks.category.deleting : t.tasks.category.deleteCategory}
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
      {t.tasks.category.deleteCategory}
    </button>
  );
}
