import { search, type ProjectSortField } from "@/repository/projects";
import { auth } from "@/lib/auth";
import { hasMinRole } from "@/lib/authz";
import Title from "@/components/Title";
import ProjectStatusBadge from "@/components/ProjectStatusBadge";
import ProjectTypeBadge from "@/components/ProjectTypeBadge";
import ProjectsToolbar from "./_components/ProjectsToolbar";
import ProjectCardActions from "./_components/ProjectCardActions";
import ProjectsActionsMenu from "./_components/ProjectsActionsMenu";
import Link from "next/link";
import { UserIcon, BoltIcon, ArrowDownTrayIcon, ArrowUpTrayIcon, TrashIcon, ClockIcon } from "@heroicons/react/24/outline";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { format } from "@/lib/i18n/format";
import { localeTag } from "@/lib/i18n/formatDate";

const PAGE_SIZE = 12;
const SORT_FIELDS: ProjectSortField[] = ["name", "status", "createdAt"];

type SearchParams = {
  q?: string;
  sort?: string;
  dir?: string;
  page?: string;
};

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const q = sp.q ?? "";
  const sortField: ProjectSortField = SORT_FIELDS.includes(sp.sort as ProjectSortField)
    ? (sp.sort as ProjectSortField)
    : "createdAt";
  const dir = sp.dir === "asc" ? "asc" : "desc";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const { projects, total } = await search({ q, sortField, dir, page, pageSize: PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const session = await auth();
  const canEdit = hasMinRole(session?.user?.role, "ADMIN");
  const locale = await getLocale();
  const t = getDictionary(locale);

  function pageHref(p: number) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (sortField !== "createdAt") params.set("sort", sortField);
    if (dir !== "desc") params.set("dir", dir);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/projects?${qs}` : "/projects";
  }

  // Shared query string for the current search/sort (used by pager + export).
  function baseParams() {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (sortField !== "createdAt") params.set("sort", sortField);
    if (dir !== "desc") params.set("dir", dir);
    return params;
  }
  const exportQs = baseParams().toString();
  const exportHref = exportQs ? `/projects/export?${exportQs}` : "/projects/export";

  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-hidden px-6 py-8">
      <div className="w-full max-w-5xl mx-auto flex flex-1 min-h-0 flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <Title title={t.projects.list.title} className="text-3xl font-bold" />

          <ProjectsActionsMenu canEdit={canEdit} exportHref={exportHref} />

          <div className="hidden md:flex items-center gap-2">
            <a
              href={exportHref}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 no-underline hover:bg-[#d1d5dc] dark:hover:bg-gray-800"
            >
              <ArrowDownTrayIcon className="h-4 w-4" />
              {t.projects.list.exportCsv}
            </a>
            {canEdit && (
              <Link
                href="/projects/import"
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 no-underline hover:bg-[#d1d5dc] dark:hover:bg-gray-800"
              >
                <ArrowUpTrayIcon className="h-4 w-4" />
                {t.projects.list.import}
              </Link>
            )}
            {canEdit && (
              <Link
                href="/projects/trash"
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 no-underline hover:bg-[#d1d5dc] dark:hover:bg-gray-800"
              >
                <TrashIcon className="h-4 w-4" />
                {t.projects.list.trash}
              </Link>
            )}
            {canEdit && (
              <Link
                href="/projects/activity"
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 no-underline hover:bg-[#d1d5dc] dark:hover:bg-gray-800"
              >
                <ClockIcon className="h-4 w-4" />
                {t.projects.list.activity}
              </Link>
            )}
          </div>
        </div>

        <ProjectsToolbar />

        <div className="flex-1 min-h-0 overflow-y-auto">
          {projects.length ? (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {projects.map((project) => (
                <li
                  key={project.id}
                  className="relative flex flex-col gap-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] p-4 text-gray-900 dark:text-gray-100 shadow-sm transition-all hover:bg-[#d1d5dc] hover:shadow-lg dark:hover:bg-gray-700"
                >
                  {canEdit && (
                    <div className="absolute right-3 top-3 z-10">
                      <ProjectCardActions
                        projectId={project.id}
                        clientId={project.client.id}
                        projectName={project.name}
                      />
                    </div>
                  )}
                  <Link
                    href={`/clients/${project.client.id}/projects/${project.id}`}
                    className={`flex min-w-0 flex-1 items-start gap-3 ${canEdit ? "pr-8" : ""}`}
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40">
                      <BoltIcon className="h-5 w-5 text-amber-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{project.name}</span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <ProjectTypeBadge type={project.type} />
                        <ProjectStatusBadge status={project.status} />
                      </div>
                      <div className="mt-1.5 flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400">
                        <UserIcon className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">
                          {project.client.companyName}
                        </span>
                      </div>
                      {(project.power != null || project.budget != null) && (
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                          {project.power != null && <span>{project.power} kWc</span>}
                          {project.budget != null && <span>{project.budget.toLocaleString(localeTag(locale))} €</span>}
                        </div>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2">
              {q ? (
                <p className="text-gray-500 dark:text-gray-400">{format(t.projects.list.noResultsFor, { q })}</p>
              ) : (
                <>
                  <p className="text-gray-500 dark:text-gray-400">{t.projects.list.noProjectsYet}</p>
                  <p className="text-sm text-gray-400 dark:text-gray-500">
                    {t.projects.list.openClientHint}
                  </p>
                </>
              )}
            </div>
          )}
        </div>

        {projects.length > 0 && totalPages > 1 && (
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
