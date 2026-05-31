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
  const router = useRouter();

  async function handleDelete() {
    setOpenModal(true);  
    // Optionally, you can add a callback here to refresh the client list or navigate away after deletion// This will refresh the clients list page after deletion
  }
  
  function handleClose() {
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
        try {
            await deleteClient(clientId);
            router.push("/clients"); // Redirect to clients list after deletion
        } catch (error) {
            console.error("Error deleting client:", error);
            // Optionally, you can show an error message to the user here
        }
    }


  if(openModal){
    return <Modal
      title="Confirmer la suppression"
      text="Etes vous sure de vouloir supprimer ce client ? Cette action est irreversible."
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