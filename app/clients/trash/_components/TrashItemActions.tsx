"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { restoreClient, permanentlyDeleteClient } from "@/actions/clients/clients";
import Modal from "@/components/Modal";
import { ArrowUturnLeftIcon, TrashIcon } from "@heroicons/react/24/outline";

export default function TrashItemActions({ clientId, name }: { clientId: number; name: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleRestore() {
    setPending(true);
    setError(null);
    const res = await restoreClient(clientId);
    setPending(false);
    if (res.type === "error") {
      setError(res.message);
      return;
    }
    router.refresh();
  }

  async function handlePermanentDelete() {
    setPending(true);
    setError(null);
    const res = await permanentlyDeleteClient(clientId);
    setPending(false);
    if (res.type === "error") {
      setError(res.message);
      return;
    }
    setConfirming(false);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleRestore}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 px-3 py-1.5 text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-600 cursor-pointer disabled:opacity-50"
      >
        <ArrowUturnLeftIcon className="h-4 w-4" />
        Restaurer
      </button>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded border border-red-500/40 px-3 py-1.5 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 cursor-pointer disabled:opacity-50"
      >
        <TrashIcon className="h-4 w-4" />
        Supprimer définitivement
      </button>

      {confirming && (
        <Modal
          title="Suppression définitive"
          text={`Supprimer définitivement « ${name} » ? Cette action est irréversible, sa photo sera aussi supprimée.`}
          error={error ?? undefined}
          textForCancel="Annuler"
          textForConfirm={pending ? "Suppression…" : "Supprimer définitivement"}
          onClose={() => !pending && setConfirming(false)}
          onConfirm={handlePermanentDelete}
        />
      )}
    </div>
  );
}
