"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ClientAvatar from "@/components/ClientAvatar";
import StatusBadge from "@/components/StatusBadge";
import Modal from "@/components/Modal";
import { deleteClients } from "@/actions/clients/clients";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";

type ClientCard = {
  id: number;
  firstName: string;
  lastName: string;
  companyName: string;
  photoUrl: string | null;
  status: string;
};

export default function ClientsGrid({ clients, canEdit = true }: { clients: ClientCard[]; canEdit?: boolean }) {
  const { t } = useTranslation();
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
      {canEdit && selected.size > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2">
          <span className="text-sm text-gray-600 dark:text-gray-300">{format(t.clients.list.selected, { count: selected.size })}</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="rounded border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
            >
              {t.common.cancel}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="inline-flex items-center gap-1.5 rounded border border-red-500/40 px-3 py-1.5 text-sm font-medium text-red-400 hover:bg-red-500/10 cursor-pointer"
            >
              {t.common.delete}
            </button>
          </div>
        </div>
      )}

      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {clients.map((client) => (
          <li key={client.id} className="relative">
            {canEdit && (
              <input
                type="checkbox"
                checked={selected.has(client.id)}
                onChange={() => toggle(client.id)}
                aria-label={format(t.clients.selectClient, { name: `${client.firstName} ${client.lastName}` })}
                className="absolute right-3 top-3 z-10 h-4 w-4 cursor-pointer accent-blue-500"
              />
            )}
            <Link
              href={`/clients/${client.id}`}
              className={`flex h-full items-center gap-4 rounded-lg border bg-white dark:bg-gray-800 p-4 text-gray-900 dark:text-gray-100 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 ${canEdit ? "pr-9" : ""} ${
                selected.has(client.id) ? "border-blue-500" : "border-gray-200 dark:border-gray-700"
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
                <span className="block truncate text-sm text-gray-500 dark:text-gray-400">{client.companyName}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {confirming && (
        <Modal
          title={t.clients.deleteModal.title}
          text={format(t.clients.deleteModal.bulkText, { count: selected.size })}
          error={error ?? undefined}
          textForCancel={t.common.cancel}
          textForConfirm={pending ? t.clients.deleteModal.deleting : t.common.delete}
          onClose={() => !pending && setConfirming(false)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}
