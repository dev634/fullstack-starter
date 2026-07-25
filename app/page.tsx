import Link from "next/link";
import { getDashboardStats } from "@/repository/clients";
import ClientAvatar from "@/components/ClientAvatar";
import StatusBadge from "@/components/StatusBadge";
import { UsersIcon, ArrowRightIcon } from "@heroicons/react/24/outline";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { blockClientFromApp } from "@/lib/portal";

export default async function HomePage() {
  await blockClientFromApp();
  const { total, byStatus, recent } = await getDashboardStats();
  const values: Record<string, number> = { total, ...byStatus };
  const t = getDictionary(await getLocale());

  const METRICS: { key: "total" | "PROSPECT" | "CLIENT" | "INACTIVE"; label: string; className: string }[] = [
    { key: "total", label: t.dashboard.totalClients, className: "text-gray-900 dark:text-gray-100" },
    { key: "PROSPECT", label: t.dashboard.prospects, className: "text-amber-300" },
    { key: "CLIENT", label: t.dashboard.clients, className: "text-green-300" },
    { key: "INACTIVE", label: t.dashboard.inactive, className: "text-gray-500 dark:text-gray-400" },
  ];

  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
      <div className="w-full max-w-5xl mx-auto space-y-8">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-3xl font-bold">{t.dashboard.title}</h1>
          <Link
            href="/clients"
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded bg-primary px-4 py-2 text-sm text-white no-underline hover:bg-primary/90"
          >
            <UsersIcon className="h-4 w-4" />
            {t.dashboard.viewClients}
          </Link>
        </div>

        {/* Metric cards */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {METRICS.map((m) => (
            <div key={m.key} className="rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] p-5 shadow-sm transition-all hover:bg-[#d1d5dc] hover:shadow-lg hover:ring-2 hover:ring-blue-300 dark:hover:bg-[#374151] dark:hover:ring-blue-600">
              <p className="text-sm text-gray-500 dark:text-gray-400">{m.label}</p>
              <p className={`mt-1 text-3xl font-semibold ${m.className}`}>{values[m.key] ?? 0}</p>
            </div>
          ))}
        </div>

        {/* Recent clients */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">{t.dashboard.recentlyAdded}</h2>
            <Link href="/clients" className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
              {t.dashboard.viewAll} <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </div>

          {recent.length ? (
            <div className="rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 shadow-sm transition-all hover:shadow-lg hover:ring-2 hover:ring-blue-300 dark:hover:ring-blue-600">
              <ul className="divide-y divide-gray-300 dark:divide-gray-700 overflow-hidden rounded-xl">
                {recent.map((client) => (
                  <li key={client.id}>
                    <Link
                      href={`/clients/${client.id}`}
                      className="flex items-center gap-4 px-4 py-3 text-gray-900 dark:text-gray-100 transition-colors hover:bg-[#d1d5dc] dark:hover:bg-[#374151]"
                    >
                      <ClientAvatar
                        photoUrl={client.photoUrl}
                        name={client.companyName}
                        size={40}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate font-medium">{client.companyName}</span>
                          <StatusBadge status={client.status} />
                        </span>
                        <span className="block truncate text-sm text-gray-500 dark:text-gray-400">{client.email}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-4 py-8 text-center text-gray-500 dark:text-gray-400 shadow-sm">
              {t.dashboard.noClientsYet}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
