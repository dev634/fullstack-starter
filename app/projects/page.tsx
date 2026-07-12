import { search, type ProjectSortField } from "@/repository/projects";
import { auth } from "@/lib/auth";
import Title from "@/components/Title";
import ProjectStatusBadge from "@/components/ProjectStatusBadge";
import ProjectsToolbar from "./_components/ProjectsToolbar";
import DeleteProjectButton from "@/app/clients/[id]/_components/DeleteProjectButton";
import Link from "next/link";
import { UserIcon, PencilSquareIcon } from "@heroicons/react/24/outline";

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
  const canEdit = session?.user?.role === "ADMIN";

  function pageHref(p: number) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (sortField !== "createdAt") params.set("sort", sortField);
    if (dir !== "desc") params.set("dir", dir);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/projects?${qs}` : "/projects";
  }

  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
      <div className="w-full max-w-3xl mx-auto space-y-6">
        <Title title="Projets" />

        <ProjectsToolbar />

        {projects.length ? (
          <>
            <ul className="divide-y divide-gray-200 dark:divide-gray-700 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
              {projects.map((project) => (
                <li key={project.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
                  <Link href={`/clients/${project.client.id}`} className="min-w-0 flex-1 hover:opacity-80">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium text-gray-900 dark:text-gray-100">{project.name}</span>
                      <ProjectStatusBadge status={project.status} />
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                      <span className="flex items-center gap-1">
                        <UserIcon className="h-3.5 w-3.5" />
                        {project.client.firstName} {project.client.lastName}
                        {project.client.companyName ? ` · ${project.client.companyName}` : ""}
                      </span>
                      {project.power != null && <span>{project.power} kWc</span>}
                      {project.budget != null && <span>{project.budget.toLocaleString("fr-FR")} €</span>}
                    </div>
                  </Link>
                  {canEdit && (
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/clients/${project.client.id}/projects/${project.id}/edit`}
                        className="inline-flex items-center gap-1 rounded border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 px-2.5 py-1.5 text-xs font-medium hover:bg-gray-200 dark:hover:bg-gray-600"
                      >
                        <PencilSquareIcon className="h-3.5 w-3.5" />
                        Modifier
                      </Link>
                      <DeleteProjectButton
                        projectId={project.id}
                        clientId={project.client.id}
                        projectName={project.name}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>

            {totalPages > 1 && (
              <nav className="flex items-center justify-center gap-4 pt-2" aria-label="Pagination">
                <PageLink href={pageHref(page - 1)} disabled={page <= 1} label="Précédent" />
                <span className="text-sm text-gray-500 dark:text-gray-400">Page {page} / {totalPages}</span>
                <PageLink href={pageHref(page + 1)} disabled={page >= totalPages} label="Suivant" />
              </nav>
            )}
          </>
        ) : (
          <div className="flex h-[45vh] flex-col items-center justify-center gap-2">
            {q ? (
              <p className="text-gray-500 dark:text-gray-400">Aucun projet ne correspond à « {q} ».</p>
            ) : (
              <>
                <p className="text-gray-500 dark:text-gray-400">Aucun projet pour le moment.</p>
                <p className="text-sm text-gray-400 dark:text-gray-500">
                  Ouvre la fiche d&apos;un client pour lui ajouter un projet.
                </p>
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
