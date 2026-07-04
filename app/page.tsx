import Link from "next/link";
import { getDashboardStats } from "@/repository/clients";
import ClientAvatar from "@/components/ClientAvatar";
import StatusBadge from "@/components/StatusBadge";
import { UsersIcon, ArrowRightIcon } from "@heroicons/react/24/outline";

const METRICS: { key: "total" | "PROSPECT" | "CLIENT" | "INACTIVE"; label: string; className: string }[] = [
  { key: "total", label: "Total clients", className: "text-gray-100" },
  { key: "PROSPECT", label: "Prospects", className: "text-amber-300" },
  { key: "CLIENT", label: "Clients", className: "text-green-300" },
  { key: "INACTIVE", label: "Inactifs", className: "text-gray-400" },
];

export default async function HomePage() {
  const { total, byStatus, recent } = await getDashboardStats();
  const values: Record<string, number> = { total, ...byStatus };

  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
      <div className="w-full max-w-5xl mx-auto space-y-8">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-3xl font-bold">Tableau de bord</h1>
          <Link
            href="/clients"
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded bg-blue-500 px-4 py-2 text-sm text-white no-underline hover:bg-blue-600"
          >
            <UsersIcon className="h-4 w-4" />
            Voir les clients
          </Link>
        </div>

        {/* Metric cards */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {METRICS.map((m) => (
            <div key={m.key} className="rounded-xl border border-gray-700 bg-gray-800 p-5">
              <p className="text-sm text-gray-400">{m.label}</p>
              <p className={`mt-1 text-3xl font-semibold ${m.className}`}>{values[m.key] ?? 0}</p>
            </div>
          ))}
        </div>

        {/* Recent clients */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Ajoutés récemment</h2>
            <Link href="/clients" className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200">
              Tout voir <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </div>

          {recent.length ? (
            <ul className="divide-y divide-gray-700 overflow-hidden rounded-xl border border-gray-700 bg-gray-800">
              {recent.map((client) => (
                <li key={client.id}>
                  <Link
                    href={`/clients/${client.id}`}
                    className="flex items-center gap-4 px-4 py-3 text-gray-100 transition-colors hover:bg-gray-700"
                  >
                    <ClientAvatar
                      photoUrl={client.photoUrl}
                      firstName={client.firstName}
                      lastName={client.lastName}
                      size={40}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-medium">{client.firstName} {client.lastName}</span>
                        <StatusBadge status={client.status} />
                      </span>
                      <span className="block truncate text-sm text-gray-400">{client.companyName}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-xl border border-gray-700 bg-gray-800 px-4 py-8 text-center text-gray-400">
              Aucun client pour le moment.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
