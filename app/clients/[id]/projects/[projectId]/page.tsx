import { getProject } from "@/actions/projects/projects";
import { findByProject } from "@/repository/tasks";
import { findChildren as findChildFolders, getBreadcrumb } from "@/repository/projectFolders";
import { findByFolder as findFilesByFolder } from "@/repository/projectFiles";
import { auth } from "@/lib/auth";
import Title from "@/components/Title";
import ProjectStatusBadge from "@/components/ProjectStatusBadge";
import ProjectTypeBadge from "@/components/ProjectTypeBadge";
import ProjectTaskRow from "@/components/ProjectTaskRow";
import ProjectFolderRow from "@/components/ProjectFolderRow";
import ProjectFileRow from "@/components/ProjectFileRow";
import AddTaskForm from "@/forms/AddTaskForm";
import CreateFolderForm from "@/forms/CreateFolderForm";
import UploadFileForm from "@/forms/UploadFileForm";
import DeleteProjectButton from "@/app/clients/[id]/_components/DeleteProjectButton";
import Link from "next/link";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { localeTag } from "@/lib/i18n/formatDate";
import {
  BoltIcon,
  CurrencyEuroIcon,
  MapPinIcon,
  CalendarIcon,
  PencilSquareIcon,
  ArrowLeftIcon,
  ClipboardDocumentListIcon,
  FolderIcon,
  HomeIcon,
  ChevronRightIcon,
} from "@heroicons/react/24/outline";

type PageProps = {
  params: Promise<{
    id: string;
    projectId: string;
  }>;
  searchParams: Promise<{
    folder?: string;
  }>;
};

export default async function ProjectDetailPage({ params, searchParams }: PageProps) {
  const { id, projectId } = await params;
  const { folder: folderParam } = await searchParams;
  const clientId = parseInt(id, 10);
  const pid = parseInt(projectId, 10);
  const parsedFolderId = folderParam ? parseInt(folderParam, 10) : NaN;
  const currentFolderId = Number.isNaN(parsedFolderId) ? null : parsedFolderId;

  const result = await getProject(pid);
  const isError = result.type === "error";
  const isEmpty = result.type === "success" && !result.data;
  const locale = await getLocale();
  const t = getDictionary(locale);

  if (isError) {
    return (
      <main className="flex flex-1 min-h-0 flex-col justify-center items-center overflow-y-auto py-8">
        <Title title={t.projects.detail.title} />
        <p className="text-red-500">{result.message}</p>
      </main>
    );
  }

  if (isEmpty || result.data?.clientId !== clientId) {
    return (
      <main className="flex flex-1 min-h-0 flex-col justify-center items-center overflow-y-auto py-8">
        <Title title={t.projects.detail.title} />
        <p>{t.projects.detail.notFound}</p>
      </main>
    );
  }

  const project = result.data!;
  const session = await auth();
  const canEdit = session?.user?.role === "ADMIN";
  const tasks = await findByProject(pid);
  const doneCount = tasks.filter((task) => task.done).length;

  const [subfolders, files, breadcrumb] = await Promise.all([
    findChildFolders(pid, currentFolderId),
    findFilesByFolder(pid, currentFolderId),
    getBreadcrumb(currentFolderId),
  ]);

  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
      <div className="w-full max-w-3xl mx-auto space-y-6">

        {/* Header */}
        <div className="overflow-hidden rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm transition-all hover:bg-gray-200 hover:shadow-lg hover:border-gray-400 dark:hover:bg-gray-700 dark:hover:border-gray-500">
          <div className="border-b border-gray-300 dark:border-gray-700 px-4 py-5 sm:px-6">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">{project.name}</h1>
              <ProjectTypeBadge type={project.type} />
              <ProjectStatusBadge status={project.status} />
            </div>
          </div>

          <dl className="px-4 py-2 sm:px-6">
            {project.power != null && (
              <div className="flex items-center gap-3 border-b border-gray-300 dark:border-gray-700 py-3 last:border-b-0">
                <BoltIcon className="h-5 w-5 shrink-0 text-gray-400 dark:text-gray-500" />
                <dt className="w-24 shrink-0 text-sm text-gray-500 dark:text-gray-400">{t.projects.detail.power}</dt>
                <dd className="min-w-0 text-sm">{project.power} kWc</dd>
              </div>
            )}
            {project.budget != null && (
              <div className="flex items-center gap-3 border-b border-gray-300 dark:border-gray-700 py-3 last:border-b-0">
                <CurrencyEuroIcon className="h-5 w-5 shrink-0 text-gray-400 dark:text-gray-500" />
                <dt className="w-24 shrink-0 text-sm text-gray-500 dark:text-gray-400">{t.projects.detail.budget}</dt>
                <dd className="min-w-0 text-sm">{project.budget.toLocaleString(localeTag(locale))} €</dd>
              </div>
            )}
            {project.address && (
              <div className="flex items-center gap-3 border-b border-gray-300 dark:border-gray-700 py-3 last:border-b-0">
                <MapPinIcon className="h-5 w-5 shrink-0 text-gray-400 dark:text-gray-500" />
                <dt className="w-24 shrink-0 text-sm text-gray-500 dark:text-gray-400">{t.projects.detail.address}</dt>
                <dd className="min-w-0 break-words text-sm">{project.address}</dd>
              </div>
            )}
            {(project.startDate || project.endDate) && (
              <div className="flex items-center gap-3 border-b border-gray-300 dark:border-gray-700 py-3 last:border-b-0">
                <CalendarIcon className="h-5 w-5 shrink-0 text-gray-400 dark:text-gray-500" />
                <dt className="w-24 shrink-0 text-sm text-gray-500 dark:text-gray-400">{t.projects.detail.dates}</dt>
                <dd className="min-w-0 text-sm">
                  {project.startDate ? new Date(project.startDate).toLocaleDateString(localeTag(locale)) : "—"}
                  {" → "}
                  {project.endDate ? new Date(project.endDate).toLocaleDateString(localeTag(locale)) : "—"}
                </dd>
              </div>
            )}
            {project.notes && (
              <div className="flex items-start gap-3 py-3">
                <dt className="w-24 shrink-0 text-sm text-gray-500 dark:text-gray-400">{t.projects.detail.notes}</dt>
                <dd className="min-w-0 whitespace-pre-wrap break-words text-sm">{project.notes}</dd>
              </div>
            )}
          </dl>

          <div className="flex flex-wrap items-center gap-2.5 border-t border-gray-300 dark:border-gray-700 bg-gray-200 dark:bg-gray-900 px-4 py-4 sm:px-6">
            {canEdit && (
              <Link
                href={`/clients/${id}/projects/${pid}/edit`}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-sm font-medium hover:bg-gray-100 dark:hover:bg-gray-600 sm:flex-none"
              >
                <PencilSquareIcon className="h-4 w-4" />
                {t.common.edit}
              </Link>
            )}
            {canEdit && <DeleteProjectButton projectId={pid} clientId={clientId} projectName={project.name} />}
            <Link
              href={`/clients/${id}`}
              className="inline-flex w-full items-center justify-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 sm:ml-auto sm:w-auto"
            >
              <ArrowLeftIcon className="h-4 w-4" />
              {t.common.back}
            </Link>
          </div>
        </div>

        {/* Tasks */}
        <div className="overflow-hidden rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm transition-all hover:bg-gray-200 hover:shadow-lg hover:border-gray-400 dark:hover:bg-gray-700 dark:hover:border-gray-500">
          <div className="flex items-center justify-between gap-4 border-b border-gray-300 dark:border-gray-700 px-4 py-4 sm:px-6">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <ClipboardDocumentListIcon className="h-5 w-5 text-blue-500" />
              {t.projects.detail.tasksHeading}
              {tasks.length > 0 && (
                <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
                  ({doneCount}/{tasks.length})
                </span>
              )}
            </h2>
          </div>

          {tasks.length ? (
            <ul className="divide-y divide-gray-300 dark:divide-gray-700">
              {tasks.map((task) => (
                <ProjectTaskRow key={task.id} task={task} clientId={clientId} projectId={pid} canEdit={canEdit} />
              ))}
            </ul>
          ) : (
            <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400 sm:px-6">
              {t.projects.detail.noTasks}
            </div>
          )}

          {canEdit && (
            <div className="border-t border-gray-300 dark:border-gray-700">
              <AddTaskForm clientId={clientId} projectId={pid} />
            </div>
          )}
        </div>

        {/* Files */}
        <div className="overflow-hidden rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm transition-all hover:bg-gray-200 hover:shadow-lg hover:border-gray-400 dark:hover:bg-gray-700 dark:hover:border-gray-500">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-300 dark:border-gray-700 px-4 py-4 sm:px-6">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <FolderIcon className="h-5 w-5 text-amber-500" />
              {t.projects.detail.filesHeading}
            </h2>
            {canEdit && <CreateFolderForm clientId={clientId} projectId={pid} parentId={currentFolderId} />}
          </div>

          {/* Breadcrumb */}
          <div className="flex flex-wrap items-center gap-1 border-b border-gray-300 dark:border-gray-700 px-4 py-2.5 text-sm text-gray-500 dark:text-gray-400 sm:px-6">
            <Link
              href={`/clients/${id}/projects/${pid}`}
              className="flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-200"
              aria-label={t.files.home}
            >
              <HomeIcon className="h-4 w-4" />
            </Link>
            {breadcrumb.map((crumb) => (
              <span key={crumb.id} className="flex items-center gap-1">
                <ChevronRightIcon className="h-3.5 w-3.5" />
                <Link
                  href={`/clients/${id}/projects/${pid}?folder=${crumb.id}`}
                  className="truncate hover:text-gray-700 dark:hover:text-gray-200"
                >
                  {crumb.name}
                </Link>
              </span>
            ))}
          </div>

          {subfolders.length || files.length ? (
            <ul className="divide-y divide-gray-300 dark:divide-gray-700">
              {subfolders.map((folder) => (
                <ProjectFolderRow key={`folder-${folder.id}`} folder={folder} clientId={clientId} projectId={pid} canEdit={canEdit} />
              ))}
              {files.map((file) => (
                <ProjectFileRow key={`file-${file.id}`} file={file} clientId={clientId} projectId={pid} canEdit={canEdit} />
              ))}
            </ul>
          ) : (
            <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400 sm:px-6">
              {t.projects.detail.emptyFolder}
            </div>
          )}

          {canEdit && (
            <div className="border-t border-gray-300 dark:border-gray-700">
              <UploadFileForm clientId={clientId} projectId={pid} folderId={currentFolderId} />
            </div>
          )}
        </div>

      </div>
    </main>
  );
}
