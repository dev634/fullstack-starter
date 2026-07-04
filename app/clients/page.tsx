import Button from "@/components/Button";
import Title from "@/components/Title";
import { search, type ClientSortField } from "@/repository/clients";
import ClientsGrid from "./_components/ClientsGrid";
import ClientsToolbar from "./_components/ClientsToolbar";
import { ArrowDownTrayIcon } from "@heroicons/react/24/outline";
import Link from "next/link";

const PAGE_SIZE = 9;
const SORT_FIELDS: ClientSortField[] = ["firstName", "lastName", "companyName", "email"];

type SearchParams = {
  q?: string;
  sort?: string;
  dir?: string;
  page?: string;
};

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const q = sp.q ?? "";
  const sortField: ClientSortField = SORT_FIELDS.includes(sp.sort as ClientSortField)
    ? (sp.sort as ClientSortField)
    : "firstName";
  const dir = sp.dir === "desc" ? "desc" : "asc";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const { clients, total } = await search({ q, sortField, dir, page, pageSize: PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Shared query string for the current search/sort (used by pager + export).
  function baseParams() {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (sortField !== "firstName") params.set("sort", sortField);
    if (dir !== "asc") params.set("dir", dir);
    return params;
  }
  function pageHref(p: number) {
    const params = baseParams();
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/clients?${qs}` : "/clients";
  }
  const exportQs = baseParams().toString();
  const exportHref = exportQs ? `/clients/export?${exportQs}` : "/clients/export";

  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
      <div className="w-full max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Title title="Clients" />
          <div className="flex items-center gap-2">
            <a
              href={exportHref}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 no-underline hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <ArrowDownTrayIcon className="h-4 w-4" />
              Export CSV
            </a>
            <Button
              text="Add Client"
              as="link"
              href="/clients/add"
              classes="inline-block whitespace-nowrap px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 text-center no-underline"
            />
          </div>
        </div>

        <ClientsToolbar />

        {clients.length ? (
          <>
            <ClientsGrid clients={clients} />

            {totalPages > 1 && (
              <nav className="flex items-center justify-center gap-4 pt-2" aria-label="Pagination">
                <PageLink href={pageHref(page - 1)} disabled={page <= 1} label="Précédent" />
                <span className="text-sm text-gray-500 dark:text-gray-400">Page {page} / {totalPages}</span>
                <PageLink href={pageHref(page + 1)} disabled={page >= totalPages} label="Suivant" />
              </nav>
            )}
          </>
        ) : (
          <div className="flex h-[45vh] flex-col items-center justify-center gap-4">
            {q ? (
              <p className="text-gray-500 dark:text-gray-400">Aucun client ne correspond à « {q} ».</p>
            ) : (
              <>
                <p className="text-gray-500 dark:text-gray-400">Aucun client pour le moment.</p>
                <Button
                  text="Ajouter un client"
                  as="link"
                  href="/clients/add"
                  classes="inline-block px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 text-center no-underline"
                />
              </>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

function PageLink({ href, disabled, label }: { href: string; disabled: boolean; label: string }) {
  if (disabled) {
    return (
      <span className="cursor-not-allowed rounded border border-gray-200 dark:border-gray-800 px-3 py-1.5 text-sm text-gray-400 dark:text-gray-600">
        {label}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="rounded border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
    >
      {label}
    </Link>
  );
}
