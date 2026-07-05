"use client";

import { deleteClient } from "@/actions/clients/clients";
import Modal from "@/components/Modal";
import { TrashIcon } from "@heroicons/react/24/outline";
import {useRouter} from "next/navigation";
import { useEffect, useState } from "react";

type DeleteClientButtonProps = {
  clientId: number;
};

export default function DeleteClientButton({ clientId }: DeleteClientButtonProps) {
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
                setError(typeof result.message === "string" ? result.message : "Erreur lors de la suppression.");
                return;
            }
            router.push("/clients"); // Redirect to clients list after deletion
        } catch (error) {
            console.error("Error deleting client:", error);
            setError("Erreur lors de la suppression. Veuillez réessayer.");
        }
    }


  if(openModal){
    return <Modal
      title="Déplacer vers la corbeille"
      text="Ce client sera déplacé vers la corbeille. Tu pourras le restaurer depuis là si besoin."
      error={error ?? undefined}
      textForCancel="Annuler"
      textForConfirm="Supprimer"
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
      Supprimer
    </button>
  );
}