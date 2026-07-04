import Button from "@/components/Button";
import Title from "@/components/Title";
import { search, type ClientSortField } from "@/repository/clients";
import ClientAvatar from "@/components/ClientAvatar";
import ClientsToolbar from "./_components/ClientsToolbar";
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

  // Build a page href that keeps the current search/sort.
  function pageHref(p: number) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (sortField !== "firstName") params.set("sort", sortField);
    if (dir !== "asc") params.set("dir", dir);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/clients?${qs}` : "/clients";
  }

  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
      <div className="w-full max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Title title="Clients" />
          <Button
            text="Add Client"
            as="link"
            href="/clients/add"
            classes="inline-block whitespace-nowrap px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 text-center no-underline"
          />
        </div>

        <ClientsToolbar />

        {clients.length ? (
          <>
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {clients.map((client) => (
                <li key={client.id}>
                  <Link
                    href={`/clients/${client.id}`}
                    className="flex h-full items-center gap-4 rounded-lg border border-gray-700 bg-gray-800 p-4 text-gray-100 transition-colors hover:bg-gray-700"
                  >
                    <ClientAvatar
                      photoUrl={client.photoUrl}
                      firstName={client.firstName}
                      lastName={client.lastName}
                      size={48}
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">
                        {client.firstName}{client.lastName ? ` ${client.lastName}` : ""}
                      </span>
                      <span className="block truncate text-sm text-gray-400">{client.companyName}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>

            {totalPages > 1 && (
              <nav className="flex items-center justify-center gap-4 pt-2" aria-label="Pagination">
                <PageLink href={pageHref(page - 1)} disabled={page <= 1} label="Précédent" />
                <span className="text-sm text-gray-400">Page {page} / {totalPages}</span>
                <PageLink href={pageHref(page + 1)} disabled={page >= totalPages} label="Suivant" />
              </nav>
            )}
          </>
        ) : (
          <div className="flex h-[45vh] flex-col items-center justify-center gap-4">
            {q ? (
              <p className="text-gray-400">Aucun client ne correspond à « {q} ».</p>
            ) : (
              <>
                <p className="text-gray-400">Aucun client pour le moment.</p>
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
      <span className="cursor-not-allowed rounded border border-gray-800 px-3 py-1.5 text-sm text-gray-600">
        {label}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="rounded border border-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700"
    >
      {label}
    </Link>
  );
}
