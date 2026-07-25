import Link from "next/link";
import { BoltIcon, BuildingOffice2Icon } from "@heroicons/react/24/outline";
import { requirePortalContext } from "@/lib/portal";
import { findByIds } from "@/repository/projects";
import ProjectStatusBadge from "@/components/ProjectStatusBadge";
import ProjectTypeBadge from "@/components/ProjectTypeBadge";
import Title from "@/components/Title";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";

// Landing page for a client-portal login: only the projects the logged-in
// contact is linked to. The proxy keeps every other role out of /portail.
export default async function PortalHomePage() {
  const ctx = await requirePortalContext();
  const projects = await findByIds([...ctx.projectIds]);
  const t = getDictionary(await getLocale());

  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
      <div className="w-full max-w-5xl mx-auto flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <Title title={t.portal.title} className="text-3xl font-bold" />
          <p className="text-sm text-gray-500 dark:text-gray-400">{ctx.companyName}</p>
        </div>

        {projects.length ? (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => (
              <li
                key={project.id}
                className="flex flex-col gap-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] p-4 text-gray-900 dark:text-gray-100 shadow-sm transition-all hover:bg-[#d1d5dc] hover:shadow-lg dark:hover:bg-gray-700"
              >
                <Link href={`/portail/projets/${project.id}`} className="flex min-w-0 flex-1 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40">
                    <BoltIcon className="h-5 w-5 text-amber-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{project.name}</span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <ProjectTypeBadge type={project.type} />
                      <ProjectStatusBadge status={project.status} />
                    </div>
                    {project.businessNumber && (
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{project.businessNumber}</p>
                    )}
                    <div className="mt-1.5 flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400">
                      <BuildingOffice2Icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{project.client.companyName}</span>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-12">
            <p className="text-gray-500 dark:text-gray-400">{t.portal.noProjects}</p>
          </div>
        )}
      </div>
    </main>
  );
}
