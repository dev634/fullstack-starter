"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ClientAvatar from "@/components/ClientAvatar";
import StatusBadge from "@/components/StatusBadge";
import Modal from "@/components/Modal";
import { deleteClients } from "@/actions/clients/clients";

type ClientCard = {
  id: number;
  firstName: string;
  lastName: string;
  companyName: string;
  photoUrl: string | null;
  status: string;
};

export default function ClientsGrid({ clients }: { clients: ClientCard[] }) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function confirmDelete() {
    setPending(true);
    setError(null);
    const res = await deleteClients([...selected]);
    setPending(false);
    if (res.type === "error") {
      setError(res.message);
      return;
    }
    setSelected(new Set());
    setConfirming(false);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-700 bg-gray-800 px-4 py-2">
          <span className="text-sm text-gray-300">{selected.size} sélectionné(s)</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="rounded border border-gray-600 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700 cursor-pointer"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="inline-flex items-center gap-1.5 rounded border border-red-500/40 px-3 py-1.5 text-sm font-medium text-red-400 hover:bg-red-500/10 cursor-pointer"
            >
              Supprimer
            </button>
          </div>
        </div>
      )}

      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {clients.map((client) => (
          <li key={client.id} className="relative">
            <input
              type="checkbox"
              checked={selected.has(client.id)}
              onChange={() => toggle(client.id)}
              aria-label={`Sélectionner ${client.firstName} ${client.lastName}`}
              className="absolute right-3 top-3 z-10 h-4 w-4 cursor-pointer accent-blue-500"
            />
            <Link
              href={`/clients/${client.id}`}
              className={`flex h-full items-center gap-4 rounded-lg border bg-gray-800 p-4 pr-9 text-gray-100 transition-colors hover:bg-gray-700 ${
                selected.has(client.id) ? "border-blue-500" : "border-gray-700"
              }`}
            >
              <ClientAvatar
                photoUrl={client.photoUrl}
                firstName={client.firstName}
                lastName={client.lastName}
                size={48}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate font-semibold">
                    {client.firstName}{client.lastName ? ` ${client.lastName}` : ""}
                  </span>
                  <StatusBadge status={client.status} />
                </span>
                <span className="block truncate text-sm text-gray-400">{client.companyName}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {confirming && (
        <Modal
          title="Confirmer la suppression"
          text={`Supprimer ${selected.size} client(s) ? Cette action est irréversible.`}
          error={error ?? undefined}
          textForCancel="Annuler"
          textForConfirm={pending ? "Suppression…" : "Supprimer"}
          onClose={() => !pending && setConfirming(false)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}
