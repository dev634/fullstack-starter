import { auth } from "@/lib/auth";
import { findTrashed } from "@/repository/projects";
import Title from "@/components/Title";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftIcon, BoltIcon } from "@heroicons/react/24/outline";
import TrashProjectActions from "./_components/TrashProjectActions";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export default async function ProjectsTrashPage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    redirect("/projects");
  }

  const trashed = await findTrashed();
  const t = getDictionary(await getLocale());

  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
      <div className="w-full max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Title title={t.projects.trash.title} />
          <Link
            href="/projects"
            className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            {t.projects.trash.backToProjects}
          </Link>
        </div>

        {trashed.length ? (
          <div className="rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] shadow-sm transition-all hover:bg-[#d1d5dc] hover:shadow-lg hover:ring-2 hover:ring-blue-300 dark:hover:bg-[#374151] dark:hover:ring-blue-600">
            <ul className="divide-y divide-gray-300 dark:divide-gray-700 overflow-hidden rounded-xl">
              {trashed.map((project) => (
                <li key={project.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40">
                      <BoltIcon className="h-5 w-5 text-amber-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-gray-900 dark:text-gray-100">{project.name}</p>
                      <p className="truncate text-sm text-gray-500 dark:text-gray-400">
                        {project.client.firstName} {project.client.lastName}
                        {project.client.companyName ? ` · ${project.client.companyName}` : ""}
                      </p>
                    </div>
                  </div>
                  <TrashProjectActions projectId={project.id} name={project.name} />
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="flex h-[45vh] flex-col items-center justify-center gap-2">
            <p className="text-gray-500 dark:text-gray-400">{t.projects.trash.empty}</p>
          </div>
        )}
      </div>
    </main>
  );
}
