"use client";

import { deleteClient } from "@/actions/clients/clients";
import Button from "@/components/Button";
import Modal from "@/components/Modal";
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
      title="Confirmer la suppression"
      text="Etes vous sure de vouloir supprimer ce client ? Cette action est irreversible."
      error={error ?? undefined}
      textForCancel="Annuler"
      textForConfirm="Supprimer"
      onClose={handleClose}
      onConfirm={handleConfirmDelete}
    />
  }

  return (
    <Button
      as="button"
      text="Supprimer"
      classes="w-30 text-center bg-red-400 rounded cursor-pointer hover:bg-red-500 px-4 py-2"
      onClick={handleDelete}
    />
  );
}