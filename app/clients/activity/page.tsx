import { auth } from "@/lib/auth";
import { listActivity } from "@/repository/activity";
import Title from "@/components/Title";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";

const ACTION_LABELS: Record<string, { label: string; className: string }> = {
  CREATED: { label: "Créé", className: "border-green-300 bg-green-100 text-green-700 dark:border-green-500/30 dark:bg-green-500/15 dark:text-green-300" },
  UPDATED: { label: "Modifié", className: "border-blue-300 bg-blue-100 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-300" },
  DELETED: { label: "Supprimé", className: "border-red-300 bg-red-100 text-red-700 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-300" },
  RESTORED: { label: "Restauré", className: "border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300" },
  PERMANENTLY_DELETED: { label: "Suppr. définitive", className: "border-red-300 bg-red-100 text-red-700 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-300" },
  IMPORTED: { label: "Import", className: "border-gray-300 bg-gray-100 text-gray-700 dark:border-gray-500/30 dark:bg-gray-500/15 dark:text-gray-300" },
};

type PageProps = {
  searchParams: Promise<{ page?: string }>;
};

export default async function ActivityPage({ searchParams }: PageProps) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    redirect("/clients");
  }

  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const { entries, total, pageSize } = await listActivity(page);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
      <div className="w-full max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Title title="Journal d'activité" />
          <Link
            href="/clients"
            className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Retour aux clients
          </Link>
        </div>

        {entries.length ? (
          <>
            <ul className="divide-y divide-gray-200 dark:divide-gray-700 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
              {entries.map((entry) => {
                const meta = ACTION_LABELS[entry.action] ?? { label: entry.action, className: "" };
                return (
                  <li key={entry.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${meta.className}`}>
                      {meta.label}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-gray-900 dark:text-gray-100">{entry.clientName}</span>
                    <span className="text-gray-500 dark:text-gray-400">{entry.actorEmail}</span>
                    <span className="text-gray-400 dark:text-gray-500">
                      {new Date(entry.createdAt).toLocaleString("fr-FR")}
                    </span>
                  </li>
                );
              })}
            </ul>

            {totalPages > 1 && (
              <nav className="flex items-center justify-center gap-4 pt-2" aria-label="Pagination">
                <PageLink page={page - 1} disabled={page <= 1} label="Précédent" />
                <span className="text-sm text-gray-500 dark:text-gray-400">Page {page} / {totalPages}</span>
                <PageLink page={page + 1} disabled={page >= totalPages} label="Suivant" />
              </nav>
            )}
          </>
        ) : (
          <div className="flex h-[45vh] flex-col items-center justify-center gap-2">
            <p className="text-gray-500 dark:text-gray-400">Aucune activité pour le moment.</p>
          </div>
        )}
      </div>
    </main>
  );
}

function PageLink({ page, disabled, label }: { page: number; disabled: boolean; label: string }) {
  if (disabled) {
    return (
      <span className="cursor-not-allowed rounded border border-gray-200 dark:border-gray-800 px-3 py-1.5 text-sm text-gray-400 dark:text-gray-600">
        {label}
      </span>
    );
  }
  return (
    <Link
      href={`/clients/activity?page=${page}`}
      className="rounded border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
    >
      {label}
    </Link>
  );
}
