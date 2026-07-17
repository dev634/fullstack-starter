import { getTaskCategory } from "@/actions/taskCategories/taskCategories";
import { auth } from "@/lib/auth";
import { hasMinRole } from "@/lib/authz";
import Title from "@/components/Title";
import ProjectTaskGroupRow from "@/components/ProjectTaskGroupRow";
import DeleteTaskCategoryButton from "@/components/DeleteTaskCategoryButton";
import Link from "next/link";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { ArrowLeftIcon, FolderIcon } from "@heroicons/react/24/outline";

type PageProps = {
  params: Promise<{
    id: string;
    projectId: string;
    categoryId: string;
  }>;
};

export default async function TaskCategoryPage({ params }: PageProps) {
  const { id, projectId, categoryId } = await params;
  const clientId = parseInt(id, 10);
  const pid = parseInt(projectId, 10);
  const cid = parseInt(categoryId, 10);

  const result = await getTaskCategory(cid);
  const t = getDictionary(await getLocale());

  if (result.type === "error") {
    return (
      <main className="flex flex-1 min-h-0 flex-col justify-center items-center overflow-y-auto py-8">
        <Title title={t.tasks.category.toggle} />
        <p className="text-red-500">{result.message}</p>
      </main>
    );
  }

  const category = result.data;
  if (!category || category.projectId !== pid || category.project.clientId !== clientId) {
    return (
      <main className="flex flex-1 min-h-0 flex-col justify-center items-center overflow-y-auto py-8">
        <Title title={t.tasks.category.toggle} />
        <p>{t.tasks.group.notFound}</p>
      </main>
    );
  }

  const session = await auth();
  const canEdit = hasMinRole(session?.user?.role, "ADMIN");
  const doneCount = category.groups.reduce((sum, group) => sum + group.doneCount, 0);
  const totalCount = category.groups.reduce((sum, group) => sum + group.totalCount, 0);

  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
      <div className="w-full max-w-3xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <FolderIcon className="h-5 w-5 text-amber-500" />
            {category.name}
            <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
              ({doneCount}/{totalCount})
            </span>
          </h1>
          <Link
            href={`/clients/${clientId}/projects/${pid}`}
            className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            {t.tasks.group.backToProject}
          </Link>
        </div>

        <div className="rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] text-gray-900 dark:text-gray-100 shadow-sm">
          <div className="overflow-hidden rounded-xl">
            {category.groups.length ? (
              <ul className="divide-y divide-gray-300 dark:divide-gray-700">
                {category.groups.map((group) => (
                  <ProjectTaskGroupRow key={group.id} group={group} clientId={clientId} projectId={pid} canEdit={canEdit} />
                ))}
              </ul>
            ) : (
              <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400 sm:px-6">
                {t.projects.detail.noTasks}
              </div>
            )}
          </div>
        </div>

        {canEdit && (
          <DeleteTaskCategoryButton
            categoryId={category.id}
            clientId={clientId}
            projectId={pid}
            categoryName={category.name}
          />
        )}
      </div>
    </main>
  );
}
