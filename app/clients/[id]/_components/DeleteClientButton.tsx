"use client";

import { deleteClient } from "@/actions/clients/clients";
import Modal from "@/components/Modal";
import { TrashIcon } from "@heroicons/react/24/outline";
import {useRouter} from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslation } from "@/components/LocaleProvider";

type DeleteClientButtonProps = {
  clientId: number;
};

export default function DeleteClientButton({ clientId }: DeleteClientButtonProps) {
  const { t } = useTranslation();
  const [openModal, setOpenModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleDelete() {
    setError(null);
    setOpenModal(true);
  }

  function handleClose() {
    setError(null);
    setOpenModal(false);
  }

    useEffect(() => {
        if (!openModal) return; // Only run when the modal is open

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setOpenModal(false);
            }
        };
      
        window.addEventListener("keydown", handleKeyDown);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [openModal]);

   async function handleConfirmDelete() {
        setError(null);
        try {
            const result = await deleteClient(clientId);
            // `deleteClient` resolves with an error object instead of throwing
            // when the deletion fails, so surface it instead of redirecting.
            if (result && typeof result === "object" && "type" in result && result.type === "error") {
                setError(typeof result.message === "string" ? result.message : t.clients.deleteModal.genericError);
                return;
            }
            router.push("/clients"); // Redirect to clients list after deletion
        } catch (error) {
            console.error("Error deleting client:", error);
            setError(t.clients.deleteModal.retryError);
        }
    }


  if(openModal){
    return <Modal
      title={t.clients.deleteModal.title}
      text={t.clients.deleteModal.text}
      error={error ?? undefined}
      textForCancel={t.common.cancel}
      textForConfirm={t.common.delete}
      onClose={handleClose}
      onConfirm={handleConfirmDelete}
    />
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded border border-red-500/40 bg-transparent px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-500/10 cursor-pointer sm:flex-none"
    >
      <TrashIcon className="h-4 w-4" />
      {t.common.delete}
    </button>
  );
}