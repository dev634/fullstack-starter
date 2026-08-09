import { auth } from "@/lib/auth";
import { can } from "@/lib/access";
import { listActivity } from "@/repository/projectActivity";
import { getAccessContext, projectIdFilter } from "@/lib/accessContext";
import Title from "@/components/Title";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAreaOrRedirect } from "@/lib/areaAccess";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { localeTag } from "@/lib/i18n/formatDate";
import { format } from "@/lib/i18n/format";
import { ACTIVITY_ACTION_CLASSES } from "@/lib/activityStyles";

type PageProps = {
  searchParams: Promise<{ page?: string }>;
};

export default async function ProjectsActivityPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!(await can(session?.user?.role, "content.activity"))) {
    redirect("/projects");
  }

  // The whole "projects" rubrique can be hidden by the caller's job function —
  // bounce to the first rubrique they can actually reach.
  await requireAreaOrRedirect("projects");

  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const { entries, total, pageSize } = await listActivity(page, projectIdFilter(await getAccessContext()));
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const locale = await getLocale();
  const t = getDictionary(locale);
  const actionLabels = t.projects.activity.actions as Record<string, string>;

  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
      <div className="w-full max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Title title={t.projects.activity.title} />
          <Link
            href="/projects"
            className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            {t.projects.activity.backToProjects}
          </Link>
        </div>

        {entries.length ? (
          <>
            <div className="rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] shadow-sm transition-all hover:bg-[#d1d5dc] hover:shadow-lg hover:ring-2 hover:ring-blue-300 dark:hover:bg-[#374151] dark:hover:ring-blue-600">
              <ul className="divide-y divide-gray-300 dark:divide-gray-700 overflow-hidden rounded-xl">
                {entries.map((entry) => {
                  const label = actionLabels[entry.action] ?? entry.action;
                  const className = ACTIVITY_ACTION_CLASSES[entry.action] ?? "";
                  return (
                    <li key={entry.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}>
                        {label}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-gray-900 dark:text-gray-100">{entry.projectName}</span>
                      <span className="text-gray-500 dark:text-gray-400">{entry.actorEmail}</span>
                      <span className="text-gray-400 dark:text-gray-500">
                        {new Date(entry.createdAt).toLocaleString(localeTag(locale))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>

            {totalPages > 1 && (
              <nav className="flex items-center justify-center gap-4 pt-2" aria-label={t.common.pagination}>
                <PageLink page={page - 1} disabled={page <= 1} label={t.common.previous} />
                <span className="text-sm text-gray-500 dark:text-gray-400">{format(t.common.pageOf, { page, total: totalPages })}</span>
                <PageLink page={page + 1} disabled={page >= totalPages} label={t.common.next} />
              </nav>
            )}
          </>
        ) : (
          <div className="flex h-[45vh] flex-col items-center justify-center gap-2">
            <p className="text-gray-500 dark:text-gray-400">{t.projects.activity.empty}</p>
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
      href={`/projects/activity?page=${page}`}
      className="rounded border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-[#d1d5dc] dark:hover:bg-gray-700"
    >
      {label}
    </Link>
  );
}
