import { auth } from "@/lib/auth";
import { hasMinRole } from "@/lib/authz";
import { findTrashed } from "@/repository/clients";
import ClientAvatar from "@/components/ClientAvatar";
import Title from "@/components/Title";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import TrashItemActions from "./_components/TrashItemActions";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export default async function TrashPage() {
  const session = await auth();
  if (!hasMinRole(session?.user?.role, "ADMIN")) {
    redirect("/clients");
  }

  const trashed = await findTrashed();
  const t = getDictionary(await getLocale());

  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
      <div className="w-full max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Title title={t.clients.trash.title} />
          <Link
            href="/clients"
            className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            {t.clients.trash.backToClients}
          </Link>
        </div>

        {trashed.length ? (
          <div className="rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] shadow-sm transition-all hover:bg-[#d1d5dc] hover:shadow-lg hover:ring-2 hover:ring-blue-300 dark:hover:bg-[#374151] dark:hover:ring-blue-600">
            <ul className="divide-y divide-gray-300 dark:divide-gray-700 overflow-hidden rounded-xl">
              {trashed.map((client) => (
                <li key={client.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <ClientAvatar
                      photoUrl={client.photoUrl}
                      firstName={client.firstName}
                      lastName={client.lastName}
                      size={40}
                    />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-gray-900 dark:text-gray-100">
                        {client.firstName} {client.lastName}
                      </p>
                      <p className="truncate text-sm text-gray-500 dark:text-gray-400">{client.companyName}</p>
                    </div>
                  </div>
                  <TrashItemActions
                    clientId={client.id}
                    name={`${client.firstName} ${client.lastName}`}
                  />
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="flex h-[45vh] flex-col items-center justify-center gap-2">
            <p className="text-gray-500 dark:text-gray-400">{t.clients.trash.empty}</p>
          </div>
        )}
      </div>
    </main>
  );
}
