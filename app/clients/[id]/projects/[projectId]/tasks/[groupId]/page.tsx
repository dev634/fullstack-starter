import { getTaskGroup } from "@/actions/taskGroups/taskGroups";
import { auth } from "@/lib/auth";
import Title from "@/components/Title";
import ProjectTaskRow from "@/components/ProjectTaskRow";
import DeleteTaskGroupButton from "@/components/DeleteTaskGroupButton";
import Link from "next/link";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { ArrowLeftIcon, Squares2X2Icon } from "@heroicons/react/24/outline";

type PageProps = {
  params: Promise<{
    id: string;
    projectId: string;
    groupId: string;
  }>;
};

export default async function TaskGroupPage({ params }: PageProps) {
  const { id, projectId, groupId } = await params;
  const clientId = parseInt(id, 10);
  const pid = parseInt(projectId, 10);
  const gid = parseInt(groupId, 10);

  const result = await getTaskGroup(gid);
  const t = getDictionary(await getLocale());

  if (result.type === "error") {
    return (
      <main className="flex flex-1 min-h-0 flex-col justify-center items-center overflow-y-auto py-8">
        <Title title={t.tasks.group.title} />
        <p className="text-red-500">{result.message}</p>
      </main>
    );
  }

  const group = result.data;
  if (!group || group.projectId !== pid || group.project.clientId !== clientId) {
    return (
      <main className="flex flex-1 min-h-0 flex-col justify-center items-center overflow-y-auto py-8">
        <Title title={t.tasks.group.title} />
        <p>{t.tasks.group.notFound}</p>
      </main>
    );
  }

  const session = await auth();
  const canEdit = session?.user?.role === "ADMIN";
  const doneCount = group.tasks.filter((task) => task.done).length;

  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
      <div className="w-full max-w-3xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Squares2X2Icon className="h-5 w-5 text-blue-500" />
            {group.name}
            <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
              ({doneCount}/{group.tasks.length})
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
            {group.tasks.length ? (
              <ul className="divide-y divide-gray-300 dark:divide-gray-700">
                {group.tasks.map((task) => (
                  <ProjectTaskRow key={task.id} task={task} clientId={clientId} projectId={pid} canEdit={canEdit} />
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
          <DeleteTaskGroupButton
            groupId={group.id}
            clientId={clientId}
            projectId={pid}
            groupName={group.name}
            taskCount={group.tasks.length}
          />
        )}
      </div>
    </main>
  );
}
