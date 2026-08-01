import Button from "@/components/Button";
import { getAccessContext, projectIdFilter } from "@/lib/accessContext";
import Title from "@/components/Title";
import { search, type ClientSortField } from "@/repository/clients";
import { auth } from "@/lib/auth";
import { can } from "@/lib/access";
import { blockClientFromApp } from "@/lib/portal";
import ClientsGrid from "./_components/ClientsGrid";
import ClientsToolbar from "./_components/ClientsToolbar";
import ClientsActionsMenu from "./_components/ClientsActionsMenu";
import { ArrowDownTrayIcon, ArrowUpTrayIcon, TrashIcon, ClockIcon, UserGroupIcon } from "@heroicons/react/24/outline";
import Link from "next/link";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { format } from "@/lib/i18n/format";

const PAGE_SIZE = 9;
const SORT_FIELDS: ClientSortField[] = ["companyName", "email", "city"];

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
  await blockClientFromApp();
  const sp = await searchParams;
  const q = sp.q ?? "";
  const sortField: ClientSortField = SORT_FIELDS.includes(sp.sort as ClientSortField)
    ? (sp.sort as ClientSortField)
    : "companyName";
  const dir = sp.dir === "desc" ? "desc" : "asc";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const { clients, total } = await search({ q, sortField, dir, page, pageSize: PAGE_SIZE, projectIds: projectIdFilter(await getAccessContext()) });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const session = await auth();
  const canEdit = (await can(session?.user?.role, "content.edit"));
  const t = getDictionary(await getLocale());

  // Shared query string for the current search/sort (used by pager + export).
  function baseParams() {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (sortField !== "companyName") params.set("sort", sortField);
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
    <main className="flex flex-1 min-h-0 flex-col overflow-hidden px-6 py-8">
      <div className="w-full max-w-5xl mx-auto flex flex-1 min-h-0 flex-col gap-6">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <Title title={t.clients.list.title} className="text-3xl font-bold" />
            <ClientsActionsMenu canEdit={canEdit} exportHref={exportHref} />
          </div>

          {/* Desktop action bar — its own row below the title. */}
          <div className="hidden md:flex flex-wrap items-center gap-2">
            <a
              href={exportHref}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 no-underline hover:bg-[#d1d5dc] dark:hover:bg-gray-800"
            >
              <ArrowDownTrayIcon className="h-4 w-4" />
              {t.clients.list.exportCsv}
            </a>
            {/* Plain <a>: this is a CSV-download route handler, not a page — Link would intercept it as client nav and break the download. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/clients/contacts/export"
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 no-underline hover:bg-[#d1d5dc] dark:hover:bg-gray-800"
            >
              <UserGroupIcon className="h-4 w-4" />
              {t.contacts.exportCsv}
            </a>
            {canEdit && (
              <Link
                href="/clients/import"
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 no-underline hover:bg-[#d1d5dc] dark:hover:bg-gray-800"
              >
                <ArrowUpTrayIcon className="h-4 w-4" />
                {t.clients.list.import}
              </Link>
            )}
            {canEdit && (
              <Link
                href="/clients/contacts/import"
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 no-underline hover:bg-[#d1d5dc] dark:hover:bg-gray-800"
              >
                <UserGroupIcon className="h-4 w-4" />
                {t.contacts.importCsv}
              </Link>
            )}
            {canEdit && (
              <Link
                href="/clients/trash"
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 no-underline hover:bg-[#d1d5dc] dark:hover:bg-gray-800"
              >
                <TrashIcon className="h-4 w-4" />
                {t.clients.list.trash}
              </Link>
            )}
            {canEdit && (
              <Link
                href="/clients/activity"
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 no-underline hover:bg-[#d1d5dc] dark:hover:bg-gray-800"
              >
                <ClockIcon className="h-4 w-4" />
                {t.clients.list.activity}
              </Link>
            )}
            {canEdit && (
              <Button
                text={t.clients.list.addClient}
                as="link"
                href="/clients/add"
                classes="inline-block whitespace-nowrap px-4 py-2 bg-primary text-white rounded hover:bg-primary/90 text-center no-underline"
              />
            )}
          </div>
        </div>

        <ClientsToolbar />

        <div className="flex-1 min-h-0 overflow-y-auto">
          {clients.length ? (
            <ClientsGrid clients={clients} canEdit={canEdit} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-4">
              {q ? (
                <p className="text-gray-500 dark:text-gray-400">{format(t.clients.list.noResultsFor, { q })}</p>
              ) : (
                <>
                  <p className="text-gray-500 dark:text-gray-400">{t.clients.list.noClientsYet}</p>
                  {canEdit && (
                    <Button
                      text={t.clients.list.addClient}
                      as="link"
                      href="/clients/add"
                      classes="inline-block px-4 py-2 bg-primary text-white rounded hover:bg-primary/90 text-center no-underline"
                    />
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {clients.length > 0 && totalPages > 1 && (
          <nav className="flex items-center justify-center gap-4 pt-2" aria-label={t.common.pagination}>
            <PageLink href={pageHref(page - 1)} disabled={page <= 1} label={t.common.previous} />
            <span className="text-sm text-gray-500 dark:text-gray-400">{format(t.common.pageOf, { page, total: totalPages })}</span>
            <PageLink href={pageHref(page + 1)} disabled={page >= totalPages} label={t.common.next} />
          </nav>
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
      className="rounded border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-[#d1d5dc] dark:hover:bg-gray-700"
    >
      {label}
    </Link>
  );
}
